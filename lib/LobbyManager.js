"use strict";

const uuidv4 = require('uuid/v4');
const Lobby = require('./Lobby.js');

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
    this.runningLobbies = {};
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

    return this.openLobbies[lobby.getLobbyId()] = lobby;
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
  tellLobbyManagerGameStarted (lobby) {
    // move to running
    delete this.openLobbies[lobby.getLobbyId()];
    this.runningLobbies[lobby.getLobbyId()] = lobby;
  }
  getLobbyCount () {
    // Might be cheaper to just list the number of socket rooms
    return {
      openLobbies: Object.keys(this.openLobbies).length,
      runningLobbies: Object.keys(this.runningLobbies).length,
    };
  }
  _onLobbyDestroy (lobby) {
    // ONLY CALLED BY THE LOBBY ITSELF -
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
  getLobbyByUsername (username) {
    // This isn't exactly... possible right now. But can be done through req.session
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
