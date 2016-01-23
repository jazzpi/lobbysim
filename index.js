'use strict'
var SteamConnection = require('./steam-connection')
  , ChatConnection = require('./chat-connection')
  , debug = require('debug')('lobbysim:index')
  , steam = require('steam')
  , knex = require('knex')
  , EventEmitter = require('events')
  , request = require('request')
  , parseXML = require('xml2js').parseString

/**
 * A channel to connect to
 * @typedef {Object} LobbySim~Channel
 * @property {number} chatID - The ID of the Steam group chat associated with this channel
 * @property {number} mainUser - The Steam ID of the main user for a chat that should always be allowed
 */

/**
 * A Twitch channel name (a string starting with #)
 * @typedef {string} LobbySim~TwitchChannel
 */

/** The main Lobby Simulator class */
class LobbySim extends EventEmitter {
  /**
   * Create a Lobby Simulator
   * @param {Object} config - The configuration
   * @param {SteamConnection~Options} config.steam - Configuration for the Steam connection
   * @param {Object} config.irc - Configuration for the Chat connection
   * @param {string} config.irc.username - Twitch username to use
   * @param {string} config.irc.password - OAuth token to authenticate with
   * @param {Object} config.db - A knex connection configuration
   * @param {number} config.subMultiplier - The multiplier for subscriber entries
   * @param {Object.<LobbySim~TwitchChannel, LobbySim~Channel>} config.channels - Channels to connect to
   */
  constructor(config) {
    super()
    this.config = config
    this.initDB(config.db)
    config.irc.channels = Object.keys(config.channels)
    this.chatConnection = new ChatConnection(config.irc)
    this.channels = []

    this.chatConnection.on('disconnected', (name, reason, reconnect) => {
      if (reason === 'Unable to connect.') {
        reconnect()
      }
    })

    this.chatConnection.addCommand('!draw', {
      requiredLevel: 'mod'
    , cb: (user, args, message, channel) => {
        switch (args[0]) {
          case 'open':
            this.openDrawing(channel, user.username)
            break
          case 'close':
            this.closeDrawing(channel, user.username, args[1])
            break
          default:
            this.drawingUsage(user.username)
        }
      }
    })

    this.chatConnection.addCommand('!play', {
      cb: (user, args, message, channel) => {
        if (!this.drawings[channel].open) {
          this.chatConnection.whisper(user.username, 'There is no open drawing!')
          debug(`${user['display-name']} tried to enter a closed drawing in ${channel}`)
          return
        }
        if (args.length === 0) {
          this.db.select('steamID', 'id')
            .from('users')
            .where('username', user.username)
            .then(rows => {
              if (rows.length === 0) {
                this.chatConnection.whisper(user.username, 'Append a link to your steam profile to enter the drawing (e.g. !play steamcommunity.com/id/resonancesteam)')
                return
              }
              if (this.drawings[channel].entries.indexOf(user.username) !== -1) {
                this.chatConnection.whisper(user.username, 'You are already in the drawing!')
                return
              }
              this.enterDrawing(user, channel)
            })
        } else {
          request(args[0] + '?xml=1', (error, response, body) => {
            if (error) {
              debug(`Error while trying to fetch ${args[0]}: ${error}`)
              // TODO
              return
            }
            if (response.statusCode !== 200) {
              debug(`Status code wasn't 200 (was ${response.statusCode}) when fetching ${args[0]}`)
            }
            parseXML(body, (err, res) => {
              if (err) {
                debug(`Error while trying to parse the response from ${args[0]}: ${err}`)
                // TODO
                return
              }
              debug(`Updating ${user.username} with ID ${res.profile.steamID64[0]}`)
              this.db.from('users')
                .where('username', user.username)
                .update({steamID: res.profile.steamID64[0]})
                .then(affected => {
                  if (affected === 0) {
                    this.db.into('users')
                      .insert({username: user.username, steamID: res.profile.steamID64[0]})
                      .then(() => {
                        this.enterDrawing(user, channel)
                      }) // Empty handler so the query gets run
                  }
                })
            })
          })
        }
      }
    })

    this.chatConnection.addCommand('!quit', {
      cb: (user, args, message, channel) => {
        let index = -2
        while ((index = this.drawings[channel].entries.indexOf(user['display-name'])) != -1) {
          this.drawings.pop(index)
        }
      }
    })

    this.chatConnection.addCommand('!winners', {
      cb: (user, args, message, channel) => {

      }
    })

    this.steamConnection = new SteamConnection(config.steam)
    this.steamChannels = {}

    this.steamConnection.friends.on('relationships', this.joinSteamChats.bind(this))
    this.steamConnection.friends.on('chatEnter', this.steamChatEntered.bind(this))
    this.steamConnection.friends.on('chatStateChange', this.steamStateChanged.bind(this))

    this.drawings = {}
    for (var channel in config.channels) {
      if (config.channels.hasOwnProperty(channel)) {
        this.drawings[channel] = {
          open: false
        , winners: []
        , entries: []
        , msgInterval: () => {}
        }
        this.on('initialized-db', () => {
          this.db.select('id', 'open').from('drawings').where('channel', channel)
            .then((rows) => {
              if (rows.length === 0) {
                debug(`Creating entry for ${channel} in database...`)
                this.db.insert({
                  open: false
                , channel: channel
                }).into('drawings').then(id => {
                  debug(`Created entry for ${channel} in database with ID ${id[0]}`)
                  this.drawings[channel].id = id[0]
                })
              } else {
                this.drawings[channel].id = rows[0].id
                this.drawings[channel].open = rows[0].open
                debug(`Fetching entries for drawing in ${channel} from database...`)
                this.db.select('username').from('entries')
                  .where('draw_id', rows[0].id)
                  .then(rows => {
                    this.drawings[channel].entries = rows
                  })
              }
            })
        })
      }
    }
  }

  /**
   * Initialize the database
   * @param {Object} cfg - A knex database configuration
   */
  initDB(cfg) {
    this.db = knex(cfg)
    let tableCount = 0
    let incTableCount = () => {
      tableCount++
      if (tableCount === 3) {
        debug('Done initializing database')
        this.emit('initialized-db')
      } else {
        debug(`Initialized table ${tableCount}/3`)
      }
    }
    debug('checking users')
    this.db.schema.hasTable('users')
      .then(exists => {
        debug('checked users')
        if (exists) {
          incTableCount()
          return
        }

        debug("users doesn't exist, creating...")
        this.db.schema.createTable('users', t => {
          t.increments('id').primary()
          t.string('username', 50).index()
          t.string('steamID', 20)
        }).then(incTableCount)
      })
    this.db.schema.hasTable('drawings')
      .then(exists => {
        if (exists) {
          incTableCount()
          return
        }

        this.db.schema.createTable('drawings', t => {
          t.increments('id').primary()
          t.string('channel', 50).index()
          t.boolean('open').defaultTo(false)
        }).then(incTableCount)
      })
    this.db.schema.hasTable('entries')
      .then(exists => {
        if (exists) {
          incTableCount()
          return
        }

        this.db.schema.createTable('entries', t => {
          t.increments('id').primary()
          t.integer('draw_id').references('id').inTable('drawings')
          t.integer('user_id').references('id').inTable('users')
        }).then(incTableCount())
      })
  }

  /**
   * Open a drawing in a channel
   * @param {string} channel - Channel to open the drawing in
   * @param {string} username - Username of the user who issued the command
   */
  openDrawing(channel, username) {
    if (this.drawings[channel].open) {
      this.chatConnection.whisper(username, 'There already is an open drawing!')
      return
    }
    this.drawings[channel].open = true
    this.drawings[channel].winners = []
    this.drawings[channel].entries = []
    this.openDrawingMsg(channel)
    this.drawings[channel].msgInterval = setInterval(this.openDrawingMsg.bind(this, channel), 30000)
    this.db('drawings').where('id', this.drawings[channel].id)
      .update({open: true})
      .then() // Empty handler so the query gets run
  }

  /**
   * Close a drawing
   * @param {string} channel - Channel to close the drawing in
   * @param {string} username - Username of the user who issued the command
   * @param {number} nWinners - How many winners to pick
   */
  closeDrawing(channel, username, nWinners) {
    if (!this.drawings[channel].open) {
      this.chatConnection.whisper(username, 'There is no open drawing!')
      return
    }
    if (isNaN(nWinners)) {
      this.drawingUsage(username)
      return
    }
    this.drawings[channel].open = false
    this.db('drawings').where('id', this.drawings[channel].id)
      .update({open: false})
      .then() // Empty handler so the query gets run
    clearInterval(this.drawings[channel].msgInterval)

    // Pick winners
    let entries = this.drawings[channel].entries
    let msg
    let winners = []
    if (entries.length === 0) {
      msg = 'The drawing has been closed with no entrants!'
    } else {
      for (let i = 0; i < nWinners; i++) {
        if (entries.length === 0) {
          break
        }
        let winner = entries[Math.floor(Math.random() * entries.length)]
        // Remove extra tickets winner had (e.g. for subs with double chances)
        for (let j = entries.length - 1; j >= 0; j--) {
          if (entries[j] === winner) {
            entries.splice(j, 1)
          }
        }
        winners.push(winner)
      }

      debug(winners)
      msg = 'The drawing has been closed! The winners are: '
      for (let i = 0; i < winners.length - 1; i++) {
        msg += winners[i] + ', '
      }
      msg += winners[winners.length - 1]
    }
    this.chatConnection.say(channel, msg)
    this.drawings[channel].winners = winners
  }

  /** Enter a user into a drawing
   * @param {Object} user - User object
   * @param {string} channel - Channel of the drawing
   */
  enterDrawing(user, channel) {
    let tickets = user.subscriber ? this.config.subMultiplier : 1
    for (let i = 0; i < tickets; i++) {
      this.drawings[channel].entries.push(user['display-name'])
      this.db.into('entries')
        .insert({username: user.username, draw_id: this.drawings[channel].id})
    }
  }

  /**
   * Usage error with !draw
   * @param {string} username - Username of the user who issued the command
   */
  drawingUsage(username) {
    this.chatConnection.whisper(username,
      '!draw usage: !draw open to open a drawing | ' +
      '!draw close <number of winners> to close a drawing')
  }

  /**
   * Tell a channel there is an open drawing
   * @param {string} channel - Channel to display the message in
   */
  openDrawingMsg(channel) {
    this.chatConnection.say(channel,
      'There is now an open drawing! Type !play <link to steam profile> to ' +
      'enter!')
  }

  /**
   * Checks if a user is allowed in a channel
   * @param {number} chatID - ID of the chat to check
   * @param {number} userID - ID of the user to check
   * @return {boolean}
   */
  isAllowed(chatID, userID) {
    return (this.channels[chatID].allowedMembers.indexOf(userID) !== -1)
  }

  /** Join the Steam group chats */
  joinSteamChats() {
    for (var key in this.config.channels) {
      if (this.config.channels.hasOwnProperty(key)) {
        let channel = this.config.channels[key]
        this.steamConnection.friends.joinChat(channel.chatID)
        this.channels[channel.chatID] = {
          allowedMembers: [channel.mainUser]
        , state: 'joining'
        , key: key
        }
      }
    }
  }

  /**
   * Handles a chatEnter event from Steam
   * @param {number} id - ID of the chat
   * @param {number} response - Response from Steam
   */
  steamChatEntered(id, response) {
    if (!(id in this.channels)) {
      debug(`Received a chatEnter event for an unknown chat (${id}): ${response}`)
      return
    }
    if (response !== steam.EChatRoomEnterResponse.Success) {
      console.error(`Couldn't join chat with ID ${id}, response was ${response}`)
      this.channels[id].state = 'failed'
      return
    }
    debug(`Successfully joined chat with ID ${id}!`)
    this.channels[id].state = 'joined'
  }

  /**
   * Handles a chatStateChange event from Steam
   * @param {number} change - Change type
   * @param {number} userID - ID of the user affected by the change
   * @param {number} chatID - ID of the chat where it happened
   * @param {number} byID - ID of the user who initiated the change
   */
  steamStateChanged(change, userID, chatID, byID) {
    let chatName = this.channels[chatID].key
    switch(change) {
      case steam.EChatMemberStateChange.Entered:
        debug(`User with ID ${userID} entered the room for ${chatName}`)
        if (!this.isAllowed(chatID, userID)) {
          this.steamConnection.ban(chatID, userID)
        }
        break
      case steam.EChatMemberStateChange.Left:
        debug(`User with ID ${userID} left the room for ${chatName}`)
        break
      case steam.EChatMemberStateChange.Disconnected:
        debug(`User with ID ${userID} disconnected from the room for ${chatName}`)
        break
      case steam.EChatMemberStateChange.Kicked:
        debug(`User with ID ${userID} was kicked from the room for ${chatName} by user with ID ${byID}`)
        break
      case steam.EChatMemberStateChange.Banned:
        debug(`User with ID ${userID} was banned from the room for ${chatName} by user with ID ${byID}`)
        break
      case steam.EChatMemberStateChange.VoiceSpeaking:
        debug(`Voice Chat is starting in room for ${chatName}`)
        break
      case steam.EChatMemberStateChange.VoiceDoneSpeaking:
        debug(`Voice Chat is ending in room for ${chatName}`)
        break
      default:
        debug(`Unknown chatStateChange event with change code ${change} in room for ${chatName}`)
      }
  }
}

module.exports = LobbySim
