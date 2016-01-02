'use strict'
var irc = require('tmi.js')
  , debug = require('debug')('lobbysim:chat-connection')
  , EventEmitter = require('events')

/** A connection to the Twitch chat */
class ChatConnection extends EventEmitter {
  /**
   * Create a chat connection
   * @param {Object} options - The options for the chat connection
   * @param {string} options.username - The Twitch username to use
   * @param {string} options.password - The OAuth token to authenticate with
   * @param {Array} [options.channels] - An array of channels to join on startup
   */
  constructor(options) {
    super()
    options.channels = typeof options.channels ? options.channels : []
    this.options = options
    this.commands = {}
    this._levels = {
      "user": 0
    , "sub": 1
    , "mod": 2
    , "broadcaster": 3
    , "admin": 4
    , "staff": 5
    }
    this.connectionStatus = {
      chat: 'not connected'
    , group: 'not connected'
    }
    this._initChatClient()
    this._initWhisperClient()
  }

  /**
   * Send a message on a channel
   * @param {string} channel - Channel name
   * @param {string} message  - Message
   */
  say(channel, message) {
    this.chatClient.say(channel, message)
  }

  /**
   * Send a whisper to a user
   * @param {string} username - Username
   * @param {string} message - Message
   */
  whisper(username, message) {
    this.whisperClient.whisper(username, message)
  }

  /**
   * Adds a command
   * @param {string} call - The call for the command (e.g. !play)
   * @param {Object} command - The command object
   * @param {ChatConnection~commandCallback} command.cb - The function to be called when the command is issued
   * @param {string} - [command.requiredLevel='user'] - The user level required to call the command. One of ['staff', 'admin', 'broadcaster', 'mod', 'sub', 'user']
   * @param {string} - [command.notAllowedMsg=`You aren't allowed to executed ${command.call}`] - The message to display when the user isn't allowed to execute the command
   * @param {string} - [command.dontWhisperMsg=`You can't execute ${command.call} by whisper`] - The message to display when trying to execute the command by whisper and allowsWhisper is false
   * @param {boolean} - [command.allowsWhisper=false] - Whether to allow executing the command by whisper. Always false if command.requiredLevel isn't 'user'
   */
  addCommand(call, command) {
    command.call = call
    this.commands[call] = command
    this.emit('add-command', call, command)
  }
  /**
   * @callback ChatConnection~commandCallback
   * @param {string|Object} user - User object (called from chat) or name (called from whisper)
   * @param {Array} args - Space-separated arguments to the command
   * @param {string} message - The message with which the command was called
   * @param {string} [channel] - The channel from which the command was called (only present if called from chat)
   */

  /**
   * Initializes the chat client
   * @private
   */
  _initChatClient() {
    this.chatClient = new irc.client({
      connection: {
        random: 'chat'
      , reconnect: true
      }
    , identity: {
        username: this.options.username
      , password: this.options.password
      }
    , channels: this.options.channels
    })

    this.chatClient.on('connecting', this._handleConnecting.bind(this, 'chat'))
    this.chatClient.on('logon', this._handleLogon.bind(this, 'chat'))
    this.chatClient.on('connected', this._handleConnected.bind(this, 'chat'))
    this.chatClient.on('disconnected', this._handleDisconnected.bind(this, 'chat'))
    this.chatClient.on('reconnect', this._handleReconnect.bind(this, 'chat'))
    this.chatClient.on('chat', this._handleChat.bind(this))

    this.chatClient.connect()
  }

  /**
   * Initializes the whisper (group chat) client
   * @private
   */
  _initWhisperClient() {
    this.whisperClient = new irc.client({
      connection: {
        server: '192.16.64.180'
      , port: 80
      , reconnect: true
      }
    , identity: {
        username: this.options.username
      , password: this.options.password
      }
    })

    this.whisperClient.on('connecting', this._handleConnecting.bind(this, 'group'))
    this.whisperClient.on('logon', this._handleLogon.bind(this, 'group'))
    this.whisperClient.on('connected', this._handleConnected.bind(this, 'group'))
    this.whisperClient.on('disconnected', this._handleDisconnected.bind(this, 'group'))
    this.whisperClient.on('reconnect', this._handleReconnect.bind(this, 'group'))
    this.whisperClient.on('whisper', this._handleWhisper.bind(this))

    this.whisperClient.connect()
  }

  /**
   * Tries to find a command that matches a message
   * @param {string|Object} user - User object or user name
   * @param {string} message - Message received
   * @param {string} [channel] - Channel from which the message was sent
   * @private
   */
  _matchCommand(user, message, channel) {
    let _split = message.split(' ')
    let command = this.commands[_split[0]]
    if (command === undefined) {
      return
    }
    let allowed
    if (typeof user === "object") {
      allowed = this._levels[user['user-type']] >= this._levels[command.requiredLevel]
    }
    return [command, allowed, _split.slice(1)]
  }

  /**
   * Sends a message if someone isn't allowed to execute a command.
   * @param {Object} command - The command object
   * @param {Object} user - The user object
   * @private
   */
  _notAllowed(command, user) {
    debug(`${user.name} isn't allowed to execute ${command.call}`)
    if (command.notAllowedMsg !== undefined) {
      this.whisper(command.notAllowedMsg)
    } else {
      this.whisper(`You aren't allowed to execute ${command.call}`)
    }
  }

  /**
   * Sends a message if a command isn't callable with whispers.
   * @param {Object} command - The command object
   * @param {string} username - Username
   * @private
   */
  _dontWhisper(command, username) {
    debug(`${username} can't execute ${command.call} by whisper`)
    if (command.dontWhisperMsg !== undefined) {
      this.whisper(command.dontWhisperMsg)
    } else {
      this.whisper(`You can't execute ${command.call} by whisper`)
    }
  }

  /**
   * Handles a 'chat' event from the chat client
   * @param {string} channel - Channel name
   * @param {Object} user - User object
   * @param {string} message - Message received
   * @param {boolean} self - Message was sent by the client
   * @private
   */
  _handleChat(channel, user, message, self) {
    if (self) {
      return
    }
    debug(`Chat message fom ${user['display-name']} to ${channel}: ${message}`)
    if (user['user-type'] === null && user.subscriber) {
      user['user-type'] = 'sub'
    }
    if (user['user-type'] === null && user.username === channel.replace('#', '')) {
      user['user-type'] = 'broadcaster'
    }
    let _ret = this._matchCommand(user, message)
    let command = _ret[0]
      , allowed = _ret[1]
      , args = _ret[2]
    if (command !== undefined) {
      if (command.allowed) {
        command.cb(user, args, message, channel)
      } else {
        this._notAllowed(command, user) // TODO
      }
    }
  }

  /**
   * Handles a 'whisper' event from the whisper client
   * @param {string} username - Username
   * @param {string} message - Message received
   * @private
   */
  _handleWhisper(username, message) {
    debug(`Whisper fom ${username}: ${message}`)
    let _ret = this._matchCommand(username, message)
    let command = _ret[0]
      , allowed = _ret[1]
      , args = _ret[2]
    if (command !== undefined) {
      if (command.allowsWhisper) {
        command.cb(username, args, message)
      } else {
        this._dontWhisper(command, username)
      }
    }
  }

  /**
   * Handles a 'connecting' event from a chat client
   * @param {string} name - The name of the client
   * @param {string} server - The IP of the server connecting to
   * @param {number} port - The port of the server connecting to
   * @private
   */
  _handleConnecting(name, server, port) {
    this.connectionStatus[name] = 'connecting'
    debug(`Connecting to ${name} server at ${server}:${port}.`)
    this.emit('connecting', name, server, port)
  }

  /**
   * Handles a 'logon' event from a chat client
   * @param {string} name - The name of the client
   * @private
   */
  _handleLogon(name) {
    this.connectionStatus[name] = 'logon'
    debug(`Logging in to ${name} server.`)
    this.emit('logon', name)
  }

  /**
   * Handles a 'connected' event from a chat client
   * @param {string} name - The name of the client
   * @param {string} server - The IP of the server connected to
   * @param {number} port - The port of the server connected to
   * @private
   */
  _handleConnected(name, server, port) {
    this.connectionStatus[name] = 'connected'
    debug(`Connected to ${name} server at ${server}:${port}.`)
    this.emit('connected', name, server, port)
  }

  /**
   * Handles a 'disconnected' event from a chat client
   * @param {string} name - The name of the client
   * @param {string} reason - Reason why client got disconnected
   * @private
   */
  _handleDisconnected(name, reason) {
    this.connectionStatus[name] = 'disconnected'
    debug(`Disconnected from ${name} server with reason "${reason}".`)
    this.emit('disconnected', name, reason, () => {
      if (name === 'chat') {
        this.chatClient.connect()
      } else {
        this.whisperClient.connect()
      }
    })
  }

  /**
   * Handles a 'reconnect' event from a chat client
   * @param {string} name - The name of the client
   * @private
   */
  _handleReconnect(name) {
    this.connectionStatus[name] = 'reconnect'
    debug(`Reconnecting to ${name} server.`)
    this.emit('reconnect', name)
  }
}

module.exports = ChatConnection
