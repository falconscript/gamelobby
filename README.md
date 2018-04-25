# gamelobby

> ES6 JS classes for Game Lobbies with friend lobbies, heartbeats and disconnect handlers

## Installation

```sh
npm install gamelobby --save
```

## Usage

This is a Game Lobby implementation I made for http://x64projects.tk/WikiRace  

Main features:
 - Friend lobbies by generating uuidv4 hashes for lobby names.  
 - Disconnect handlers for BOTH timeouts and players closing the page due to the heartbeats.  
 - Object-oriented design for overriding methods.  
 - Event-based callbacks for game lobbies
 - Websocket based (using SailsJS, but can be overridden) for maximum speed.  

LobbyManager inherits from node's EventEmitter, and thus allows you to subscribe/publish events  
of your own choosing as well as add hooks to the existing ones.

```js
class LobbyManager extends EventEmitter {
  constructor (LobbyClass=Lobby) {
    ...

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

    ...
};
```

```js
// Example of code you would write
const gamelobby = require('gamelobby');
const lobbyManager = new gamelobby.LobbyManager();


// Get a lobby with specified config.
let lobbyConfig = { mode: "BATTLE" }; // other ideas: { isFriendLobby: true, isTeamGame: true }
let lobby = lobbyManager.getOpenLobbyWithCriteria(lobbyConfig); // ONLY gets lobbies where mode is "BATTLE"

// If no lobbies exist with these requirements, create one
if (!lobby) {
  lobby = lobbyManager.createOpenLobby(lobbyConfig);
}

// Add player to this lobby - this will emit GAME_START if the required number of players is reached
let playerConfig = { username: "billy", userId: 4, character: "turtle" };
lobby.addPlayer(req.socket, playerConfig); // is synchronous, will emit PLAYER_ADDED

// PLAYER_ADDED event will send all players the playerConfig for each player.
// lobby.playerList will be an array of Player objects with .playerConfig accessible


// Add GAME_START handler to determine the teams of a game
lobbyManager.on("GAME_START", (lobby) => {
  // Set these attributes before GAME_START is emitted to players so they are available
  // Because events are done synchronously, we will properly have these set before lobby broadcasts them
  lobby.lobbyConfig['levelStage'] = "opening_level"; // so all players know the right stage
  lobby.playerList.forEach(p => p.playerConfig.team = "BLUE"); // all BLUE team
});

// Add GAME_OVER handler to update player ranks upon completion
lobbyManager.on("GAME_OVER", (lobby) => {
  lobby.playerList.forEach((player, index) => {
    
    let didWin = player.getWinStatus() == gamelobby.Player.WIN;
    let didLose = player.getWinStatus() == gamelobby.Player.LOST ? 1 : 0),
    let didDisconnect = player.getConnectionStatus() == gamelobby.Player.DISCONNECTED;

    // example idea of saving data
    await SomeDatabase.update(player.playerConfig.username, { win: didWin, loss: didLose, disconnects: didDisconnect });
    lobby.destroyLobby(); // remove lobby from lobbyManager

});
```

Lobbies automatically check for disconnections by receiving heartbeats every few seconds.  
Have your web app send heartbeats to another endpoint and update the lobby.  
Timeouts result in USER_DISCONNECT being emitted.  
```js
// Update heartbeat for accurate disconnections
let lobby = lobbyManager.getLobbyBySocket(req.socket); // req.socket is your socket identifier (in sails at least)
if (!lobby) {
  return res.json({error: "NO_LOBBY_FOUND_FOR_HEARTBEAT"}); // player not in any lobby
}
lobby.updateClientHeartbeat(req.socket, new Date().getTime());
```

Used in tandem with my LobbyClient.js on the front end (to be released in future) helps a lot.  
More features available, read the code to suit your needs.  

## TODO:
Add easier Redis support, maybe as a subclass.  

## Credits
http://x64projects.tk/
