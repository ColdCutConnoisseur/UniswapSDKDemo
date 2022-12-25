# NOTE: OLD README

# SETUP
- Make sure you have node / npm installed on your computer--you can install using homebrew (if on mac)
- Run ```npm install``` to install dependencies
- Create a .env file with INFURA_API_KEY, POOL_ADDRESS, etc.
- See 'sample_env_file' for an example of above, but save as ".env"


- Run with ```npx ts-node pool_trial.ts```
- Should output pool info for USDC/WETH 0.3% Pool





NOTES FOR DEVELOPER (CAN IGNORE):
***FOR IMPORT ISSUE WITH UNISAWP/PERIPHERY***

Had the same issue, solved it by cd into the node_modules/@uniswap/v3-periphery, run npm i followed by npx hardhat compile.

Hope this helps.
