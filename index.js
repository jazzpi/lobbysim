'use strict'
var SteamConnection = require('./steam-connection')
  , ChatConnection = require('./chat-connection')
  , debug = require('debug')('lobbysim:index')
  , steam = require('steam')

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
class LobbySim {
  /**
   * Create a Lobby Simulator
   * @param {Object} config - The configuration
   * @param {SteamConnection~Options} config.steam - Configuration for the Steam connection
   * @param {Object} config.irc - Configuration for the Chat connection
   * @param {string} config.irc.username - Twitch username to use
   * @param {string} config.irc.password - OAuth token to authenticate with
   * @param {Object.<LobbySim~TwitchChannel, LobbySim~Channel>} config.channels - Channels to connect to
   */
  constructor(config) {
    this.config = config
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

      }
    })

    this.chatConnection.addCommand('!quit', {
      cb: (user, args, message, channel) => {

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
      }
    }
  }

  /**
   * Open a drawing in a channel
   * @param {string} channel - Channel to open the drawing in
   * @param {string} username - Username of the user who issued the command
   */
  openDrawing(channel, username) {
    if (this.drawings[channel].open) {
      this.chatConnection.whisper(username, 'There is already an open drawing!')
      return
    }
    this.drawings[channel].open = true
    this.drawings[channel].winners = []
    this.drawings[channel].entries = []
    this.openDrawingMsg(channel)
    this.drawings[channel].msgInterval = setInterval(this.openDrawingMsg.bind(this, channel))
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
    clearInterval(this.drawings[channel].msgInterval)

    // Pick winners
    let entries = this.drawings[channel].entries
    let winners = []
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

    let msg = 'The drawing has been closed! The winners are: '
    for (let i = 0; i < winners.length - 1; i++) {
      msg += winners[i] + ', '
    }
    msg += winners[winners.length - 1]
    this.chatConnection.say(channel, msg)
    this.drawings[channel].winners = winners
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
      'There is now an open drawing! Type !play ' +
      '<link to steam profile> to enter!')
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
