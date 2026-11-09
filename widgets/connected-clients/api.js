'use strict';

module.exports = {
  async getConnectedClients({ homey }) {
    return homey.app.getConnectedClientsSummary();
  },
};
