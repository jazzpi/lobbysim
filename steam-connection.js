'use strict'
var steam = require('steam')
  , fs = require('fs')
  , crypto = require('crypto')
  , debug = require('debug')('lobbysim:steam-connection')
  , assign = require('object-assign')
  , EventEmitter = require('events')

/**
 * Options to the SteamConnection
 * @typedef {Object} SteamConnection~Options
 * @property {string} account_name - The name of the Steam account to be used
 * @property {string} password - The password of the Steam account to be used
 * @property {string} [auth_code] - The Steam Guard code. Not required if Steam Guard is disabled or there is a sentry file.
 * @property {string} [sentryLocation='.sentryfile'] - The location for the sentry file
 */

/** A connection to Steam */
class SteamConnection extends EventEmitter {
  /**
   * Create a Steam connection
   * @param {SteamConnection~Options} options - The options for the Steam connection
   */
  constructor(options) {
    super()
    this.options = assign({
      sentryLocation: '.sentryfile'
    }, options)
    this.connected = false
    this.sentryRead = false
    this.sentryFile = null
    this.sentryHash = null

    this.client = new steam.SteamClient()
    this.user = new steam.SteamUser(this.client)
    this.friends = new steam.SteamFriends(this.client)

    this.connect()
    this.readSentry()
  }

  /**
   * Create a SHA1 hash
   * @return {Buffer} - The digested hash
   */
  static makeSha(bytes) {
    var hash = crypto.createHash('sha1')
    hash.update(bytes)
    return hash.digest()
  }

  /** Connect to Steam */
  connect() {
    this.client.on('connected', () => {
      this.connected = true
      this.emit('connected')
      debug('Connected!')
      this.checkLogOn()
    })
    this.client.connect()
    this.emit('connecting')
    debug('Connecting...')
  }

  /** Read the sentry file (if it exists) */
  readSentry() {
    debug('Reading sentry file...')
    fs.stat(this.options.sentryLocation, (err) => {
      if (err === null) {
        debug('Sentry file exists.')
        fs.readFile(this.options.sentryLocation, (err, data) => {
          if (err) {
            throw err
          }
          this.sentryFile = data
          this.sentryHash = SteamConnection.makeSha(data)
          this.sentryRead = true
          this.emit('readSentry')
          debug('Read sentry file')
          this.checkLogOn()
        })
      } else {
        debug('Sentry file doesn\'t exist.')
        this.sentryRead = true
        this.checkLogOn()
      }
    })
  }

  /** Log on if possible */
  checkLogOn() {
    if (this.readSentry && this.connected) {
      this.client.on('logOnResponse', this._logOnResponseHandler.bind(this))
      this.user.on('updateMachineAuth', this._updateMachineAuthHandler.bind(this))
      debug('Logging in...')
      if (this.sentryFile !== null) {
        this.user.logOn({
          account_name: this.options.account_name
        , password: this.options.password
        , sha_sentryfile: this.sentryHash
        })
      } else if (this.options.auth_code !== undefined) {
        this.user.logOn({
          account_name: this.options.account_name
        , password: this.options.password
        , auth_code: this.options.auth_code
        })
      } else {
        this.user.logOn({
          account_name: this.options.account_name
        , password: this.options.password
        })
      }
    }
  }

  /**
   * Handles a logOnResponse event from the client
   * @param {Object} resp - The response
   * @private
   */
  _logOnResponseHandler(resp) {
    switch(resp.eresult) {
      case steam.EResult.OK:
        debug('Logged in!')
        this.friends.setPersonaState(steam.EPersonaState.Online)
        break
      case steam.EResult.AccountLogonDenied:
        console.error('Login denied - Steam Guard code required. Please ' +
                      'check your E-Mail (***@' + resp.email_domain +').')
        break
      case steam.EResult.InvalidLoginAuthCode:
        console.error('Invalid Steam Guard code!')
        break
      case steam.EResult.ExpiredLoginAuthCode:
        console.error('Steam Guard code expired!')
        break
      default:
        console.error('Login failed with unknown error: ' + resp.eresult)
    }
    this.client.on('error', (err) => {
      console.warn('Steam connection closed by the server!')
      this.emit('clientError')
    })
    this.emit('logOnResponse', resp.eresult)
  }

  /**
   * Handles an updateMachineAuth even from the user
   * @param {Object} resp - The response
   * @param {Function} cb - The callback
   * @private
   */
  _updateMachineAuthHandler(resp, cb) {
    if (this.sentryFile === null) {
      debug('Writing sentry...')
      fs.writeFile(this.options.sentryLocation, resp.bytes, function(err) {
        if (err !== null) {
          console.warn('Writing sentry failed!')
        } else {
          cb({ sha_file: SteamConnection.makeSha(resp.bytes) })
        }
      })
    }
  }
}

module.exports = SteamConnection
