# Uniswap SDK Demo
Use Uniswap SDK to monitor whether a liquidity pool position has moved outside of price limits.  If it has,
liquidate the position and then atomically swap for the correct ratio of coins for a new position, and mint
said position.  Continue the price check loop infinitely.

# SETUP
- Run ```npm install``` to install dependencies (make sure you have node / npm installed on your computer)
- Create a .env file that matches the 'sample_env_file' format. Save as '.env'.


## Position Config
- Set __tokenId__ attribute as the token ID for the current LP position you'd like to monitor.
- __testMode__ is a switch whether you want to run functionality on Goerli (testnet) or mainnet.
- __Lower / Upper Limit dollar amounts__ will be price margins added and subtracted from the current price to get new
position price limits.
- __newPositionTotalUsdAmount__ is the amount (in USD) you would like split amongst assets in new pool position.
- __feeTier__ is the fier tier for newly minted LP positions.  500 --> 0.0005 --> 0.05% pool


# Running
- Run with ```npx ts-node pool_trial.ts```
- To run in test mode on the Goerli testnet, set the 'testMode' attribute in position_config to 'true'.
- Get some test ETH at https://goerlifaucet.com/


# TODO / Further Considerations
- [x] Add 'useNative' in AddLiqOptions
- [ ] make 'inputPermitToken' call in multicall, not outside of atomic swap + mint


# General Notes / Troubleshooting
NOTES FOR DEVELOPER (CAN IGNORE):
***FOR IMPORT ISSUE WITH UNISAWP/PERIPHERY***

"Had the same issue, solved it by cd into the node_modules/@uniswap/v3-periphery, run npm i followed by npx hardhat compile.

Hope this helps."
