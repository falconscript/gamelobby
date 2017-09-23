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
 - Websocket based (using SailsJS, but can be overridden) for maximum speed.  


Unfortunately, the usage of this module is pretty difficult.  
Below, I provide a very simple part of using it. To fully understand it, you will  
probably have to read the code.


```js
var gamelobby = require('gamelobby');
var Player = gamelobby.Player;

class YourGameNameLobby extends gamelobby.Lobby {
  constructor(config) {
    super(config);
  }

  startGame () {
    // ... Set extra game running config
    super.startGame();
  }

  endGame (args) {
    super.endGame(args);

    // update player stats in database
    var processedCount = 0;
    this.playerList.forEach((player, index) => {
      // ... update for player

      // Completed all userstats updates
      if (++processedCount == this.playerList.length) {
        return this.destroyLobby(); // This game is over
      }
    });
  }
};
```

## TODO:
Add easier Redis support, maybe as a subclass.  
Add teams support.  

## Credits
http://x64projects.tk/
