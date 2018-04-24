"use strict";

/**
 * Player - A class representing a player in ONE game.
 * A user of the site can only be one Player object at any
 * given time; and the object is regenerated upon every
 * new game joined.
 */
class Player {
	constructor (args) {
    this.socket = args.socket;
    this.username = args.username;
    this.playerConfig = args.playerConfig || {};

    // put in additional attributes from arguments onto the Player object
    Object.assign(this, args);

    // Status for player
    this.status = Player.CONNECTED;
    this.lastHeartbeatTime = new Date(); // now
    
  }
  updateStatus (newStatus) {
    this.status = newStatus;
  }
  toJsonObj () {
    return {
       username: this.username,
       lastHeartbeatTime: this.lastHeartbeatTime,
       status: this.status,
       playerConfig: this.playerConfig,
    };
  }
  // possibly have some attributes be private, some public,
  // for representation in the UI?
};


// Player Statuses
// Attach all of these onto the Player object (Class Statics)
Object.assign(Player, {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  LOST: "LOST",
  WIN: "WIN",
});


module.exports = Player;
