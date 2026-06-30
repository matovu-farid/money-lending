import BigNumber from "bignumber.js";

// Match the server's BigNumber config (set in engine.ts)
BigNumber.config({
  DECIMAL_PLACES: 10,
  ROUNDING_MODE: BigNumber.ROUND_HALF_UP,
});
