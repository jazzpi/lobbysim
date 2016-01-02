'use strict'
var config = require('./config.json')
  , SteamConnection = require('./steam-connection')
  , ChatConnection = require('./chat-connection')
  , debug = require('debug')('lobbysim:index')

var steamConnection = new SteamConnection({
  account_name: config.steam.account_name
, password: config.steam.password
, auth_code: config.steam.auth_code
})

var chatConnection = new ChatConnection({
  username: config.irc.username
, password: config.irc.password
, channels: Object.keys(config.channels)
})

chatConnection.on('disconnected', (name, reason, reconnect) => {
  if (reason === 'Unable to connect.') {
    reconnect()
  }
})
