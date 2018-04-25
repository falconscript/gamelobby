"use strict";

const uuidv4 = require('uuid/v4');
const Lobby = require('./Lobby.js'); // default lobby class, may be overridden
const EventEmitter = require('events');

/**
 * LobbyManager
 *
 * The absence of Redis means we manage all lobbies in memory of current process
 */
class LobbyManager extends EventEmitter {
  constructor (LobbyClass=Lobby) {
    super(); // EventEmitter constructor

    // If we ever add a database model to at least accompany
    // the in-memory lobbies, then in this function we would
    // delete the existing open lobbies here (they'd be from old sessions)

    this.LobbyClass = LobbyClass;

    this.openLobbies = {};
    this.runningLobbies = {};

    this.setMaxListeners(30); // EventEmitter maxListeners for any event

    // Events and handlers for LobbyManager. Hook your own with .on("") for these same events
    // NOTE: COMMENTED EVENTNAMES HERE ARE VALID. LobbyManager just doesn't need to hook them
    // Each of these below events (LOBBY_CREATED/LOBBY_DESTROYED) are also broadcasted to every
    // player of a lobby the event corresponds to via websockets.
    this.EVENTS = {
      //LOBBY_CREATED: (lobby) => { },
      LOBBY_DESTROYED: this._onLobbyDestroy, // (lobby) => { },
      //PLAYER_ADDED: (lobby, player) => { }, // Fires on player add. Does NOT fire on lobby creation (as first player joins)
      GAME_START: this._onLobbyGameStart, // (lobby) => { },
      //GAME_OVER: (lobby) => { },
      //USER_DISCONNECT: (lobby, disconnectedList) => { }, // one or more players disconnected (missed heartbeats)
      //GAME_OVER_DUE_TO_DISCONNECTS: (lobby) => { }, // game cannot continue due to disconnections
      //TOOK_WAY_TOO_LONG: (lobby) => { }, // Game hit maximum time allowed to run
    };

    // Register the specified events above
    for (let eventName in this.EVENTS) {
      this.on(eventName, this.EVENTS[eventName].bind(this));
    }
  }
  _generateLobbyId () {
    // Continually try uuidv4 substring until we get an unused name.
    // Names are not double-used ever -- meaning a friend lobby and a random
    // lobby will never have the same name
    let name = '';
    do {
      name = uuidv4().substring(0, 12);
    } while (this.getLobbyBySocketRoomName(name));

    return name;
  }
  createOpenLobby (gameConfig={}) {
    let lobby = new this.LobbyClass(this._generateLobbyId(), this, gameConfig);

    this.openLobbies[lobby.getLobbyId()] = lobby;

    this.emit('LOBBY_CREATED', lobby);
    return lobby;
  }
  getOpenLobbyWithCriteria (criteria={}) {
    // simply return first open lobby. YES I KNOW THIS ITERATES ALL THE LOBBIES AND I HATE IT
    for (let lobbyId in this.openLobbies) {
      let lobby = this.openLobbies[lobbyId];

      // check full but not started (all players must heartbeat before start)
      if (lobby.isFull()) {
        continue;
      }

      // Check all criteria matches this lobby
      let isMatch = true;
      for (let i in criteria) {
        if (lobby.lobbyConfig[i] != criteria[i]) {
          isMatch = false;
          break; // lobby does not match one or more criteria
        }
      }

      if (isMatch) {
        return lobby; // lobby open and is criteria match, send it up
      }
    }

    return null; // no lobby of criteria match
  }
  _onLobbyGameStart (lobby) {
    // move to running
    delete this.openLobbies[lobby.getLobbyId()];
    this.runningLobbies[lobby.getLobbyId()] = lobby;
  }
  // kind of expensive call!
  getLobbyCount () {
    // Might be cheaper to just list the number of socket rooms
    return {
      openLobbies: Object.keys(this.openLobbies).length,
      runningLobbies: Object.keys(this.runningLobbies).length,
    };
  }
  // kind of expensive call!
  getTotalPlayerCount () {
    return {
      openLobbyPlayers: Object.keys(this.openLobbies).map(
          lobbyId => this.openLobbies[lobbyId].getSocketCount()
        ).reduce((a, b) => a + b, 0),
      runningLobbyPlayers: Object.keys(this.runningLobbies).map(
          lobbyId => this.runningLobbies[lobbyId].getSocketCount()
        ).reduce((a, b) => a + b, 0),
    };
  }
  _onLobbyDestroy (lobby) {
    // EMITTED BY THE LOBBY ITSELF -
    // 1. On completion of game or
    // 2. When a waiting lobby has lost all players
    // This is basically its call to remove itself from the lobby listings
    delete this._getHashForLobby(lobby.getLobbyId())[lobby.getLobbyId()];
  }
  // NOTE: Could override this function only to remove sails dependency
  getLobbyBySocket (socket) {
    let rooms = sails.sockets.socketRooms(socket);
    let sockId = sails.sockets.getId(socket);

    // Apparently each socket starts in its own "room" with the name being its ID
    // Remove this solo room and the global '' room from our results also
    let relevantRooms = rooms.filter(room => room !== sockId && room !== '');

    return this.getLobbyBySocketRoomName(relevantRooms[0]); // Might be null?
  }
  _getHashForLobby (socketRoomName) {
    return (this.openLobbies[socketRoomName] && this.openLobbies) ||
      (this.runningLobbies[socketRoomName] && this.runningLobbies) || null;
  }
  getLobbyBySocketRoomName (socketRoomName) {
    return this.openLobbies[socketRoomName] ||
      this.runningLobbies[socketRoomName] || null;
  }
};



/*
// Get ID of req.socket
let socketId = sails.sockets.getId(req.socket); // => "BetX2G-2889Bg22xi-jy"

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
