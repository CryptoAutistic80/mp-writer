/* eslint-disable */
import axios from 'axios';

module.exports = async function () {
  // Configure axios for tests to use.
  const host = process.env.HOST ?? 'localhost';
  const port =
    process.env.PORT ?? process.env.DEEP_RESEARCH_MCP_PORT ?? '4100';
  axios.defaults.baseURL = `http://${host}:${port}`;
};
