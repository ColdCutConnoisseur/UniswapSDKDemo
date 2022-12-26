# Uniswap SDK Demo
Use Uniswap SDK to monitor whether a liquidity pool position has moved outside of price limits.  If it has,
liquidate the position and then atomically swap for the correct ratio of coins for a new position, and mint
said position.  Continue the price check loop infinitely.

# SETUP
- Run ```npm install``` to install dependencies (make sure you have node / npm installed on your computer)
- Create a .env file that matches the 'sample_env_file' format. Save as '.env'.


## Position Config


# Running
- Run with ```npx ts-node pool_trial.ts```
- To run in test mode on the Goerli testnet, set the 'testMode' attribute in position_config to 'true'.




# TODO / Further Considerations
[ ] Add 'useNative' in AddLiqOptions
[ ] make 'inputPermitToken' call in multicall, not outside of atomic swap + mint


# General Notes / Troubleshooting
NOTES FOR DEVELOPER (CAN IGNORE):
***FOR IMPORT ISSUE WITH UNISAWP/PERIPHERY***

"Had the same issue, solved it by cd into the node_modules/@uniswap/v3-periphery, run npm i followed by npx hardhat compile.

Hope this helps."
