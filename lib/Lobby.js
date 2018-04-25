"use strict";

const Player = require('./Player.js');

/**
 * Lobby
 *
 * A lobby for a game, running or not
 */
class Lobby {
  constructor (socketRoomName, lobbyManager, lobbyConfig={}) {
    // Initialized as lobby
    this.lobbyStatus = Lobby.WAITING; // Set initial status
    this.playerList = [];
    this.MINIMUM_PLAYER_COUNT_BEFORE_DC_GAMEOVER = lobbyConfig.MINIMUM_PLAYER_COUNT_BEFORE_DC_GAMEOVER || 2;


    // Optional User defined game lobby config
    this.lobbyConfig = lobbyConfig;
    this.lobbyConfig.playerCountForGame = this.lobbyConfig.playerCountForGame || 2;

    // Dynamic game config given by lobby manager
    this.socketRoomName = socketRoomName;
    this.lobbyManager = lobbyManager;

    this.scheduleDisconnectCheck();
  }

  updateStatus (newStatus) {
    if (!(newStatus in this.constructor) || typeof(newStatus) != "string") {
      console.log(`[!] WARNING! gamelobby.Lobby.updateStatus setting to unsupported status!`);
    }

    this.lobbyStatus = newStatus;
  }
  getStatus (newStatus) { return this.lobbyStatus; }
  isWaitingInLobby () { return this.getStatus() == Lobby.WAITING; }
  isGamePlaying () { return this.getStatus() == Lobby.PLAYING; }

  getLobbyId () {
    // Using the socketRoomName as lobby ID
    return this.socketRoomName;
  }
  getConfigItem (itemName) {
    return this.lobbyConfig[itemName];
  }
  scheduleDisconnectCheck () {
    this.dcTimeoutInt = setTimeout(this.checkForDisconnects.bind(this), 2000);
  }
  checkForDisconnects () {
    let now = new Date().getTime();
    let timeoutThreshold = this.isWaitingInLobby() ? Lobby.LOBBY_TIMEOUT : Lobby.INGAME_TIMEOUT;

    // Can occur in a lobby, but never in Lobby.PLAYING state... Shouldn't happen now
    if (!this.playerList.length) {
      return process.env.DEBUG && console.log("[D] LOBBY_DC_CHECK_NO_PLAYERS");
    }

    let disconnectedList = this.playerList.filter((player, index) => {
      return (now - player.lastHeartbeatTime) > timeoutThreshold;
        // || !player.getSocket().isValidOrSomethingOrIsInRoom
    });

    // Don't want to call handleDisconnect outside of ingame/inlobby
    if (disconnectedList.length && (this.isWaitingInLobby() || this.isGamePlaying())) {
        // Handle disconnections. Game may end here
        this.handleDisconnect(disconnectedList);
    }

    // Perform check to see if this game has taken WAY too long
    if (this.isGamePlaying() &&
      (now - this.startTime > Lobby.TIMEOUT_FOR_TOTAL_GAME_RUNTIME)) {

      // Game has gone on way too long. Closing, killing.
      return this.endGame(Lobby.TIMEOUT_FOR_TOTAL_GAME_RUNTIME);
    }

    // Schedule next check if the game/lobby is still open
    if (this.isWaitingInLobby() || this.isGamePlaying()) {
      this.scheduleDisconnectCheck();
    }
  }
  destroyLobby () {
    this.updateStatus(Lobby.DESTROYED);
    clearTimeout(this.dcTimeoutInt); // don't check for DCs anymore
    this.clearRoom();

    this.lobbyManager.emit("LOBBY_DESTROYED", this);
  }
  jsonSerializePlayerArray (players) {
    return players.map(p => p.toJsonObj());
  }
  getPlayersJSONSerialized () {
    return this.jsonSerializePlayerArray(this.playerList);
  }
  // Called when someone closes the game OR a disconnect timeout occurs
  handleDisconnect (disconnectedList) {
    this.emitDisconnect(disconnectedList);

    process.env.DEBUG && console.log("[D] gamelobby.Lobby.debug:",
      disconnectedList, "lobbyStatus:", this.getStatus());

    // Determine what to do based on lobbyStatus
    if (this.isWaitingInLobby()) {
      this.gameFilledTime = null; // game not eligible to start yet

      // Remove player from lobby
      disconnectedList.forEach(p => this.removePlayer(p));

      // Delete lobby if no players and game not started
      if (this.playerList.length == 0) {
        this.destroyLobby();
      }
    } else if (this.isGamePlaying()) {
      // Don't remove from game, just mark disconnected
      disconnectedList.forEach(p => p.updateConnectionStatus(Player.DISCONNECTED));

      let connectedPlayerCount = this.playerList.filter(p => p.isStillConnected()).length;

      // Check if enough players to continue the game
      if (connectedPlayerCount < this.MINIMUM_PLAYER_COUNT_BEFORE_DC_GAMEOVER) {
        this.endGame(Lobby.DISCONNECTED);
      } 
      // Else game continues
    }
    // Else Some other Lobby status... Do nothing. Shouldn't get here
  }
  broadcastNewEvent (originatingPlayer, eventName, jsonData, shouldExcludeOriginatingPlayer=false) {
    if (shouldExcludeOriginatingPlayer) {
      sails.sockets.broadcast(this.getSocketRoomName(), eventName, jsonData, originatingPlayer.getSocket());
    } else {
      sails.sockets.broadcast(this.getSocketRoomName(), eventName, jsonData);
    }
  }
  emitEventToSinglePlayer (targetPlayer, eventName, jsonData) {
		sails.sockets.broadcast(targetPlayer.getSocket().id, eventName, jsonData);
  }
  addToRoom (player) {
    // add to socket room - can be overridden
    sails.sockets.join(player.getSocket(), this.getSocketRoomName());
  }
  removeFromSocketRoom (player) {
    sails.sockets.leave(player.getSocket(), this.getSocketRoomName());
  }
  clearRoom () {
    // Remove sockets from room
    this.playerList.forEach(p => this.removeFromSocketRoom(p));
  }
  emitPlayerAdded (player) {
    this.lobbyManager.emit("PLAYER_ADDED", this, player);

    // Emit new player name
    this.broadcastNewEvent(null, 'PLAYER_ADDED', {
      playerList: this.getPlayersJSONSerialized(),
      lobbyConfig: this.lobbyConfig, // mostly to let new player know config
    });
  }
  emitGameStart () {
    this.playerList.forEach(p => p.updateWinStatus(Player.UNDETERMINED)); // set win_status

    this.startConfig = {}; // any listeners on GAME_START may modify startConfig to be sent
    this.lobbyManager.emit("GAME_START", this);

    // Emit start stuff
    this.broadcastNewEvent(null, "GAME_START", {
      playerList: this.getPlayersJSONSerialized(),
      lobbyConfig: this.lobbyConfig, // let all players know config
      startConfig: Object.assign(this.startConfig, { // additional start data
        _randomSeed: Math.floor(Math.random() * 100000), // seed for synchronized randomness if desired
      }),
    });
  }
  emitGameOver () {
    this.lobbyManager.emit("GAME_OVER", this);

    // Send GAME_OVER to the players as a winner is decided
    this.broadcastNewEvent(null, "GAME_OVER", {
      updatedPlayerList: this.getPlayersJSONSerialized(),
    });
  }
  emitDisconnect (disconnectedList) {
    // Will the player already be gone from the socket room??
    disconnectedList.forEach(p => this.removeFromSocketRoom(p));

    this.lobbyManager.emit("USER_DISCONNECT", this, disconnectedList);

    // Emit disconnect to still connected sockets
    this.broadcastNewEvent(null, "USER_DISCONNECT", {
      disconnectedList: this.jsonSerializePlayerArray(disconnectedList),
    });
  }
  emitGameOverDueToDisconnects () {
    this.lobbyManager.emit("GAME_OVER_DUE_TO_DISCONNECTS", this);

    // Emit disconnect to still connected sockets
    this.broadcastNewEvent(null, "GAME_OVER_DUE_TO_DISCONNECTS", {
      updatedPlayerList: this.getPlayersJSONSerialized(),
    });
  }
  getSocketRoomName () { return this.socketRoomName; }
  getPlayerBySocket (socket) {
    return this.playerList.filter(p => p.getSocket() == socket)[0]; // may be null
  }
  addPlayer (socket, playerConfig={}) {
    let newPlayer = new Player(socket, playerConfig);

    this.playerList.push(newPlayer);
    this.emitPlayerAdded(newPlayer);
    this.addToRoom(newPlayer);

    // Game full, but NOT starting yet.
    // Start in the heartbeat check when we KNOW for sure each person's
    // latest heartbeat is AFTER right now
    if (this.isFull()) {
      this.gameFilledTime = new Date().getTime();
    }

    return true; // was added successfully
  }
  // Useful for checking uniqueness. If playerConfig has "username" for example,
  // pass in "username", "bobby" to see if any user in the lobby has playerConfig.username == "bobby"
  numPlayerConfigsInLobbyMatchAttribute (key, value) {
    return this.playerList.filter(p => p.playerConfig[key] === value).length;
  }
  removePlayer (player) {
    this.playerList.splice(this.playerList.indexOf(player), 1);
  }
  // NOTE: This is a good function to override in a subclass
  startGame () {
    process.env.DEBUG && console.log("[D] gamelobby.Lobby.debug - Starting game!");
    this.updateStatus(Lobby.PLAYING);
    this.startTime = new Date().getTime();
    this.emitGameStart();
  }
  // Perform endgame analysis stuff and store data
  // Attach to the 'GAME_OVER' event to do things like update ranks
  endGame (NEW_STATUS, shouldDestroyLobby=true) {
    clearTimeout(this.dcTimeoutInt); // don't check for DCs anymore
    this.updateStatus(NEW_STATUS || Lobby.GAME_OVER); // Update status (Lobby.GAME_OVER by default)
    this.endTime = new Date().getTime();

    // XXX Will need to add some checks here to look for disconnect status

    // If this game was a timeout from going on too long
    if (this.getStatus() == Lobby.TIMEOUT_FOR_TOTAL_GAME_RUNTIME) {
      // Just pretend the game never even happened
      this.lobbyManager.emit("TOOK_WAY_TOO_LONG", this);
      this.broadcastNewEvent(null, 'TOOK_WAY_TOO_LONG', {});
      return (shouldDestroyLobby) ? this.destroyLobby() : null;
    }

    // Update still connected people to losers
    this.playerList.forEach((p) => {
      if (p.isStillConnected() && p.getWinStatus() != Player.WIN) {
        p.updateWinStatus(Player.LOST);
      }
    });

    // Let everyone know game results
    if (this.getStatus() == Lobby.GAME_OVER) {
      this.emitGameOver();
    } else if (this.getStatus() == Lobby.DISCONNECTED) {
      this.emitGameOverDueToDisconnects();
    }

    return (shouldDestroyLobby) ? this.destroyLobby() : null;
  }
  areAllPlayerHeartbeatsAfterTime (time) {
    return this.playerList.filter(p => p.lastHeartbeatTime < time).length == 0;
  }
  haveAllPlayersHeartbeatedSinceFilling () {
    return this.gameFilledTime && this.areAllPlayerHeartbeatsAfterTime(this.gameFilledTime);
  }
  updateClientHeartbeat (socket, time=new Date().getTime()) {
    // yes, additional hash table would be faster, but would use more memory
    let player = this.getPlayerBySocket(socket);
    if (!player) {
      return process.env.DEBUG && console.log("NO_PLAYER_FOUND_IN_UPDATEHEARTBEAT")
    }

    player.lastHeartbeatTime = time;

    // If we have enough, and everyone's latest heartbeat is AFTER the fill time,
    // start game!
    if (this.isFull() && this.isWaitingInLobby() && this.haveAllPlayersHeartbeatedSinceFilling()) {
      this.startGame();
    }
  }
  getSocketCount () {
    // XXX I'm not sure which one is more robust...
    // it depends on whether closed sockets are automatically removed
    // completely from all rooms on closing. Might find out later
    return this.playerList.length;
    //return sails.sockets.subscribers(this.getSocketRoomName()).length;
  }
  isFull () { return this.getSocketCount() == this.getConfigItem('playerCountForGame'); }
};

// Static Lobby class Statuses
// Assign each attribute directly onto Lobby class
Object.assign(Lobby, {
  JUSTCREATED: "JUSTCREATED", // only applicable to client

  WAITING: "WAITING",
  PLAYING: "PLAYING",
  GAME_OVER: "GAME_OVER",

  DESTROYED: "DESTROYED",
  DISCONNECTED: "DISCONNECTED", // Status for game end by disconnect

  // Default values for timeout events, can set on Lobby to override
  LOBBY_TIMEOUT: 8000, // specified in ms
  INGAME_TIMEOUT: 30000, // specified in ms
  TIMEOUT_FOR_TOTAL_GAME_RUNTIME: 2 * 60 * 60 * 1000, // specified in ms... 2 hours
});


module.exports = Lobby;
