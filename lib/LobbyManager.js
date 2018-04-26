"use strict";

const uuidv4 = require('uuid/v4');
const Lobby = require('./Lobby.js'); // default lobby class, may be overridden
const EventEmitter = require('events');
const deterministicStringify = require('json-stable-stringify');
const objecthasherjs = require("objecthasherjs");



// return an array of values that are in both arrays a and b
function getArrayIntersection (a, b) {
  let bSet = new Set(b);
  return [...new Set(a)].filter(x => bSet.has(x));
}

// Make these methods private to enforce user does not try to sideline indexing setting
let _getAllOpenLobbiesWithCriteria_withoutIndexing = Symbol();
let _getAllOpenLobbiesWithCriteria_withIndexing = Symbol();

let _getFirstOpenLobby_withoutIndexing = Symbol();
let _getFirstOpenLobby_withIndexing = Symbol();

/**
 * LobbyManager
 *
 * The absence of Redis means we manage all lobbies in memory of current process.
 * 
 * All lobbies are by default indexed by their member variable lobbyConfig
 * into LobbyManager's lobbyConfigAttributeHashes and lobbyConfigExactHashes hashes.
 * 
 * This uses a bit of memory as it makes an array for every combination of lobbyConfig
 * that LobbyManager ever sees. If you have TONS of different variations of config, or
 * somehow you include dynamic items such as the current datetime, you may want to disable
 * this indexing feature. It's a very fast optimization to avoid having to use the fallback
 * method of iterating through ALL the lobbies to find the ones that match a lobbyConfig
 * Disable with these two flags:
 * @param args.disableExactConfigHashing default false
 * @param args.disableConfigIndexing default false
 * 
 */
class LobbyManager extends EventEmitter {
  constructor (args={}) {
    super(); // EventEmitter constructor

    this.LobbyClass = args.LobbyClass || Lobby;

    // This is because multiple LobbyManagers may exist for a single web app.
    // Socket room names will be prefixed on creation to ensure that instance owns them
    this.socketRoomPrefix = args.socketRoomPrefix || "gamelobby-"; //uuidv4().substring(0, 6); // random alternative

    this.openLobbies = {};
    this.runningLobbies = {};

    // Variable to index lobbyConfig items as they come in
    this.lobbyConfigAttributeHashes = {};
    this.lobbyConfigExactHashes = {};
    this.DELIMITER = "_D#_";

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

    // Indexing on lobbyConfig for performant queries of lobbies can be disabled
    // Enforce private so that it cannot be modified while running
    let isConfigIndexingEnabled = !args.disableConfigIndexing; // set to false to disable
    this.isConfigIndexingEnabled = function () { return isConfigIndexingEnabled; };

    let isExactConfigHashingEnabled = !args.disableExactConfigHashing; // set to false to disable
    this.isExactConfigHashingEnabled = function () { return isExactConfigHashingEnabled; };
  }
  _generateLobbyId (prefix="") {
    // Continually try uuidv4 substring until we get an unused name.
    // Names are not double-used ever -- meaning a friend lobby and a random
    // lobby will never have the same name
    let name = '';
    do {
      name = uuidv4().substring(0, 6);
    } while (this.getLobbyBySocketRoomName(name));

    return prefix + name;
  }

  createOpenLobby (lobbyConfig={}) {
    let lobby = new this.LobbyClass(this._generateLobbyId(this.socketRoomPrefix), this, lobbyConfig);

    this.openLobbies[lobby.getLobbyId()] = lobby;

    // Set up the hashes for fast access to determine lobbies with specified config
    if (this.isConfigIndexingEnabled()) {
      for (let key in lobbyConfig) {
        let kv_pair = key + this.DELIMITER + deterministicStringify(lobbyConfig[key]);

        if (!(kv_pair in this.lobbyConfigAttributeHashes)) {
          this.lobbyConfigAttributeHashes[kv_pair] = []; // will be array of lobbyIds
        }

        this.lobbyConfigAttributeHashes[kv_pair].push(lobby.getLobbyId());
      }
    }

    if (this.isExactConfigHashingEnabled()) {
      if (!(lobby.lobbyConfig_hashed_id in this.lobbyConfigExactHashes)) {
        this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id] = [];
      }

      this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id].push(lobby.getLobbyId());
    }

    // Must freeze lobbyConfig because modifications
    // would invalidate this.lobbyConfigAttributeHashes and each lobby.lobbyConfig_hashed_id
    Object.freeze(lobby.lobbyConfig);

    this.emit('LOBBY_CREATED', lobby);
    return lobby;
  }



  // This is an optional optimization query to get lobbies considerably faster
  getOpenLobbiesWithExactLobbyConfig(lobbyConfig={}) {
    if (this.isExactConfigHashingEnabled()) {
      let hashId = objecthasherjs.calculateObjectHash(lobbyConfig);
      return this.lobbyConfigExactHashes[hashId] &&
        this.lobbyConfigExactHashes[hashId].map(lobbyId => this.openLobbies[lobbyId]).filter(
        // The lobby && check is because these matchedLobbyIds will include those from runningLobbies.
        lobby => lobby && !lobby.isFull() // only get open ones
      ) || []; // return empty array if none found
    } else {
      return this.getAllOpenLobbiesWithCriteria(lobbyConfig); // Will be significantly slower
    }
  }
  getFirstOpenLobbyWithExactLobbyConfig (lobbyConfig={}) {
    return this.getOpenLobbiesWithExactLobbyConfig(lobbyConfig)[0];
  }
  
  getFirstOpenLobbyWithCriteria (criteria={}) {
    if (this.isConfigIndexingEnabled()) {
      return this[_getFirstOpenLobby_withIndexing](criteria);
    } else {
      return this[_getFirstOpenLobby_withoutIndexing](criteria);
    }
  }

  getAllOpenLobbiesWithCriteria (criteria={}) {
    if (this.isConfigIndexingEnabled()) {
      return this[_getAllOpenLobbiesWithCriteria_withIndexing](criteria);
    } else {
      return this[_getAllOpenLobbiesWithCriteria_withoutIndexing](criteria);
    }
  }
  // More efficient on memory, less efficient on CPU
  [_getFirstOpenLobby_withoutIndexing] (criteria={}) {
    // YES I KNOW THIS ITERATES ALL THE LOBBIES AND I HATE IT
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

    return null; // no lobby found
  }

  // More efficient on CPU, less efficient on memory
  [_getFirstOpenLobby_withIndexing] (criteria={}) {
    return this[_getAllOpenLobbiesWithCriteria_withIndexing](criteria)[0];
  }

  // More CPU efficient, slightly less memory-efficient
  [_getAllOpenLobbiesWithCriteria_withIndexing] (criteria) {
    let matchedLobbyIds = null;

    // Find intersections of the matches for each attribute!
    for (let key in criteria) {
      let kv_pair = key + this.DELIMITER + deterministicStringify(criteria[key]);

      if (!(kv_pair in this.lobbyConfigAttributeHashes)) {
        return []; // No matches exist at all, so there can be no intersection set
      }

      let lobbyIdsWithMatchingAttr = this.lobbyConfigAttributeHashes[kv_pair];

      // first attribute check, we start with all of them
      if (matchedLobbyIds === null) {
        matchedLobbyIds = lobbyIdsWithMatchingAttr;
      } else {
        matchedLobbyIds = getArrayIntersection(matchedLobbyIds, lobbyIdsWithMatchingAttr);
      }

      if (matchedLobbyIds.length == 0) {
        return []; // Intersection set is dead. Return nothing at all.
      }
    }

    if (matchedLobbyIds === null) {
      // special case, user passed in {} for config and wanted all open lobbies
      matchedLobbyIds = Object.keys(this.openLobbies);
    }

    // return all lobbies that are not full now
    return matchedLobbyIds.map(lobbyId => this.openLobbies[lobbyId]).filter(
      // The lobby && check is because these matchedLobbyIds will include those from runningLobbies
      lobby => lobby && !lobby.isFull() // only get open ones
    );
  }

  // More memory efficient, less CPU efficient.
  [_getAllOpenLobbiesWithCriteria_withoutIndexing] (criteria={}) {
    let matches = [];

    // YES I KNOW THIS ITERATES ALL THE LOBBIES AND I HATE IT
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
        matches.push(lobby); // lobby open and is criteria match, send it up
      }
    }

    return matches;
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

    if (this.isConfigIndexingEnabled()) {
      let lobbyConfig = lobby.lobbyConfig;

      for (let key in lobbyConfig) {
        let kv_pair = key + this.DELIMITER + deterministicStringify(lobbyConfig[key]);

        let i = this.lobbyConfigAttributeHashes[kv_pair].indexOf(lobby.getLobbyId());
        this.lobbyConfigAttributeHashes[kv_pair].splice(i, 1);

        // delete this key if there are no more instances of it
        if (!this.lobbyConfigAttributeHashes[kv_pair].length) {
          delete this.lobbyConfigAttributeHashes[kv_pair];
        }
      }
    }

    if (this.isExactConfigHashingEnabled()) {
      // Delete the exact hash for this 
      let i = this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id].indexOf(lobby.getLobbyId());
      this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id].splice(i, 1);

      // delete this key if there are no more instances of it
      if (!this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id].length) {
        delete this.lobbyConfigExactHashes[lobby.lobbyConfig_hashed_id];
      }
    }
  }

  // NOTE: Could override this function only to remove sails dependency
  getLobbyBySocket (socket) {
    let rooms = sails.sockets.socketRooms(socket);
    let sockId = sails.sockets.getId(socket);

    // Apparently each socket starts in its own "room" with the name being its ID
    // Remove this solo room and the global '' room from our results also
    let relevantRooms = rooms.filter(
      room => room !== sockId && room !== ''
        && room.indexOf(this.socketRoomPrefix) == 0 // Enforce prefix 
    );

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
