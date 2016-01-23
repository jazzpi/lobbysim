var Steam = require('steam'),
    readline = require('readline'),
    fs = require('fs'),
    crypto = require('crypto'),
    debug = require('debug')('lobbysim:steam')

// Config
var winners = []

function checkLogon() {
  if (foundlogin && connected) logon()
}

function makeSha(bytes) {
  var hash = crypto.createHash('sha1')
  hash.update(bytes)
  return hash.digest()
}

function getChatMembers() {
  return Object.keys(steamFriends.chatRooms[chatID])
}

function isAllowedMember(member) {
  return (member === mainUser || winners.indexOf(member) !== -1)
}

function banIllegalMembers() {
  var members = getChatMembers()
  var illegalMembers = members.filter(function(member) {
    return !isAllowedMember(member)
  })
  illegalMembers.forEach(function(member) {
    steamFriends.ban(chatID, member)
  })
}

var steamClient = new Steam.SteamClient()
var steamUser = new Steam.SteamUser(steamClient)
var steamFriends = new Steam.SteamFriends(steamClient)

var connected = false
var login = {}
var foundlogin = false
var sentryfile, sentryhash
var rl = readline.createInterface(process.stdin, process.stdout)

if (fs.existsSync(loginlocation)) {
  login = require(loginlocation)
  foundlogin = true
} else {
  rl.question('Username: ', function(answer) {
    login.user = answer
    rl.question('Password: ', function(answer) {
      login.pass = answer
      debug('Writing login to ' + loginlocation)
      fs.writeFile(loginlocation, JSON.stringify(login), function(err) {
        if (err) {
          debug('Error while writing the login:')
          debug(err)
        } else {
          debug('Wrote login!')
        }
      })
      foundlogin = true
      checkLogon()
    })
  })
}

if (fs.existsSync(sentrylocation)) {
  sentryfile = fs.readFileSync(sentrylocation)
  sentryhash = makeSha(sentryfile)
  debug('Read sentry from ' + sentrylocation)
} else {
  sentryfile = null
}

steamClient.connect()
debug('Connecting...')
steamClient.on('connected', function() {
  debug('Connected!')
  connected = true
  checkLogon()
})

function logon() {
  debug('Logging in...')
  if (sentryfile !== null) {
    steamUser.logOn({
      account_name: login.user
    , password: login.pass
    , sha_sentryfile: sentryhash
    })
  } else {
    if (login.auth !== undefined) {
      steamUser.logOn({
        account_name: login.user
      , password: login.pass
      , auth_code: login.auth
      })
    } else {
      steamUser.logOn({
        account_name: login.user
      , password: login.pass
      })
    }
  }
}

steamClient.on('logOnResponse', function(logonResp) {
  if (logonResp.eresult === Steam.EResult.OK) {
    debug('Logged in!')
  } else if (logonResp.eresult === Steam.EResult.AccountLogonDenied) {
    console.error('Login denied - Steam Guard code required. Please check your E-Mail (***@' + logonResp.email_domain + ').')
    connected = false
    foundlogin = false
    steamClient.connect()
    rl.question('Steam Guard code: ', function(answer) {
      login.auth = answer
      foundlogin = true
      checkLogon()
    })
  } else if (logonResp.eresult === Steam.EResult.InvalidLoginAuthCode) {
    console.error('Invalid Steam Guard code!')
  } else if (logonResp.eresult === Steam.EResult.ExpiredLoginAuthCode) {
    console.error('Steam Guard code expired!')
  } else {
    console.error('Login failed!')
    debug(logonResp)
  }
})

steamUser.on('updateMachineAuth', function(response, callback) {
  if (sentryfile === null) {
    debug('Writing sentry...')
    fs.writeFile(sentrylocation, response.bytes)
    callback({ sha_file: makeSha(response.bytes) })
  }
})

steamClient.on('error', function(error) {
  console.error('An error occured')
  debug(error)
})

steamFriends.on('relationships', function() {
  debug('Attempting to join chat...')
  steamFriends.joinChat(chatID)
})

steamFriends.on('chatEnter', function(id, response) {
  if (id !== chatID) return
  if (response === Steam.EChatRoomEnterResponse.Success) {
    debug('Successfully joined chat!')
    debug('Banning illegal members...')
    banIllegalMembers()
  }
})

steamFriends.on('chatStateChange', function(change, user, chat, by) {
  switch (change) {
    case Steam.EChatMemberStateChange.Entered:
      debug(`${user} entered the room.`)
      if (!isAllowedMember(user)) steamFriends.ban(chat, user)
      break
    case Steam.EChatMemberStateChange.Left:
      debug(`${user} left the room.`)
      break
    case Steam.EChatMemberStateChange.Disconnected:
      debug(`${user} disconnected from the room.`)
      break
    case Steam.EChatMemberStateChange.Kicked:
      debug(`${user} was kicked from the room by ${by}.`)
      break
    case Steam.EChatMemberStateChange.Banned:
      debug(`${user} was banned from the room by ${by}`)
      break
    case Steam.EChatMemberStateChange.VoiceSpeaking:
      debug('Voice chat starting')
      break
    case Steam.EChatMemberStateChange.VoiceDoneSpeaking:
      debug('Voice chat ended')
      break
    default:
      debug('Unknown member state change: ' + change)
  }
})
