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
    this.connectionStatus = {
      chat: 'not connected'
    , group: 'not connected'
    }
    this._initChatClient()
    this._initWhisperClient()
  }

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
    , channels: this.options.channels //TODO
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
   * Handles a 'chat' event from the chat client
   * @param {string} channel - Channel name
   * @param {Object} user - User object
   * @param {string} message - Message received
   * @param {boolean} self - Message was sent by the client
   */
  _handleChat(channel, user, message, self) {

  }

  /**
   * Handles a 'whisper' event from the whisper client
   * @param {string} username - Username
   * @param {string} message - Message received
   */
  _handleWhisper(username, message) {

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
    this.emit('disconnected', name, reason)
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
