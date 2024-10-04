'use strict';

module.exports = {
  async getLatestSpeedtestResult({ homey, query }) {
    const result = await homey.app.getLatestSpeedtestResult();
    return result;
  },
};
