"use strict";

var uuidv4 = require('uuid/v4');
var Lobby = require('./Lobby.js');

/**
 * LobbyManager
 *
 * The absence of Redis means we manage all lobbies in memory of current process
 */
class LobbyManager {
  constructor (args={}) {
    // If we ever add a database model to at least accompany
    // the in-memory lobbies, then in this function we would
    // delete the existing open lobbies here (they'd be from old sessions)

    this.LobbyClass = args.LobbyClass || Lobby;

    this.openLobbies = {};
    this.friendLobbies = {}; // Can be open OR closed... Friendlobbies don't move to running
    this.runningLobbies = {};
  }
  getUniqueLobbyName () {
    var name = '';

    // Continually try uuidv4 substring until we get an unused name.
    // Names are not double-used ever -- meaning a friend lobby and a random
    // lobby will never have the same name
    do {
      name = uuidv4().substring(0, 12);
    } while (this.getLobbyBySocketRoomName(name));

    return name;
  }
  // Gets friend lobby... Creates if doesn't exist
  getFriendLobby (gameConfig) {
    if (gameConfig.socketRoomName) {
      return this.getLobbyBySocketRoomName(gameConfig.socketRoomName);
    } else {
      gameConfig.socketRoomName = this.getUniqueLobbyName();
      gameConfig.isFriendLobby = true;
      gameConfig.lobbyManager = this;
      var lobby = new this.LobbyClass(gameConfig);
      this.friendLobbies[lobby.getLobbyId()] = lobby;
      return lobby;
    }
  }
  createOpenLobby (gameConfig) {
    gameConfig.socketRoomName = this.getUniqueLobbyName();
    gameConfig.lobbyManager = this;
    var lobby = new this.LobbyClass(gameConfig);
    this.openLobbies[lobby.getLobbyId()] = lobby;
    return lobby;
  }
  getOpenLobby (gameConfig) {
    // simply return first open lobby...
    for (var lobbyId in this.openLobbies) {
      if (!this.openLobbies[lobbyId].isFull()) {
        return this.openLobbies[lobbyId];
      }
    }

    // if we get here, we have to create a new lobby and return it
    return this.createOpenLobby(gameConfig);
  }
  tellLobbyManagerGameStarted (lobby) {
    // Friend lobbies don't move to running
    if (!lobby.getConfigItem('isFriendLobby')) {
      delete this.openLobbies[lobby.getLobbyId()];
      this.runningLobbies[lobby.getLobbyId()] = lobby;
    }
  }
  getLobbyCount () {
    // Return list of open socket rooms or just key count for lobbies?
  }
  destroyLobby (lobby) {
    // ONLY CALLED BY THE LOBBY ITSELF -
    // 1. On completion of game or
    // 2. When a waiting lobby has lost all players
    // This is basically its call to remove itself from the lobby listings
    delete this._getHashForLobby(lobby.getLobbyId())[lobby.getLobbyId()];
  }
  // NOTE: Could override this function only to remove sails dependency
  getLobbyBySocket (socket) {
    var rooms = sails.sockets.socketRooms(socket);
    var sockId = sails.sockets.getId(socket);

    // Apparently each socket starts in its own "room" with the name being its ID
    // Remove this solo room and the global '' room from our results also
    var relevantRooms = rooms.filter((room, index) => {
      return room !== sockId && room !== '';
    });

    return this.getLobbyBySocketRoomName(relevantRooms[0]); // Might be null?
  }
  getLobbyByUsername (username) {
    // This isn't exactly... possible right now. But can be done through req.session
  }
  _getHashForLobby (socketRoomName) {
    if (this.openLobbies[socketRoomName]) {
      return this.openLobbies;
    } else if (this.runningLobbies[socketRoomName]) {
      return this.runningLobbies;
    } else if (this.friendLobbies[socketRoomName]) {
      return this.friendLobbies;
    }
    return null;
  }
  getLobbyBySocketRoomName (socketRoomName) {
    return this.openLobbies[socketRoomName] || // DO NOT PUT THIS ON NEXT LINE!!
      this.runningLobbies[socketRoomName] ||
      this.friendLobbies[socketRoomName];
  }
};



/*
// Get ID of req.socket
var socketId = sails.sockets.getId(req.socket); // => "BetX2G-2889Bg22xi-jy"

Get the IDs of all sockets subscribed to a room.
sails.sockets.subscribers(roomName);
sails.sockets.subscribers('supportchat');
// => ['BetX2G-2889Bg22xi-jy', 'BTA4G-8126Kr32bi-za']

// Join a room
sails.sockets.join(socket, roomName);

// Get an arry of room names of this socket (each socket is in '')
sails.sockets.socketRooms( socket )

// Get string ID of socket
sails.sockets.getId(socket);

// Send event name to a room
sails.sockets.broadcast( roomName, [eventNameString], data, [socketToOmit] )

// Remove a socket from a room... I wonder if a DC causes this?
sails.sockets.leave( socket, roomName )
*/


module.exports = LobbyManager;
