'use strict';

module.exports = {
  async getRealtimeTraffic({ homey }) {
    return homey.app.getRealtimeTraffic();
  },
};
