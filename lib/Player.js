"use strict";

/**
 * Player - A class representing a player in ONE game.
 * A user of the site can only be one Player object at any
 * given time; and the object is regenerated upon every
 * new game joined.
 */
class Player {
	constructor (socket, playerConfig={}) {
    this._socket = socket;
    this.playerConfig = playerConfig || {};

    // Status for player
    this.status = Player.CONNECTED;
    this.win_status = Player.UNDETERMINED;
    this.lastHeartbeatTime = new Date().getTime(); // now
  }
  getSocket () { return this._socket; }
  getConnectionStatus () { return this.status; }
  getWinStatus () { return this.win_status; }
  updateConnectionStatus (newStatus) {
    if (!(newStatus in this.constructor) || typeof(newStatus) != "string") {
      console.log(`[!] WARNING! gamelobby.Player.updateConnectionStatus setting to unsupported status!`);
    }

    this.status = newStatus;
  }
  isStillConnected () { return this.getConnectionStatus() == Player.CONNECTED; }
  updateWinStatus (newStatus) {
    if (!(newStatus in this.constructor) || typeof(newStatus) != "string") {
      console.log(`[!] WARNING! gamelobby.Player.updateWinStatus setting to unsupported status!`);
    }

    this.win_status = newStatus;
  }
  markVictor () { this.updateWinStatus(Player.WIN); }

  toJsonObj () {
    return {
      lastHeartbeatTime: this.lastHeartbeatTime,
      status: this.getConnectionStatus(),
      win_status: this.getWinStatus(),
      playerConfig: this.playerConfig,
    };
  }
};


// Player Statuses
// Attach all of these onto the Player object (Class Statics)
Object.assign(Player, {
  // .status (connection status)
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",

  // .win_status
  UNDETERMINED: "UNDETERMINED",
  LOST: "LOST",
  WIN: "WIN",
  DRAW: "DRAW",
});


module.exports = Player;
