# SETUP
- Create a .env file with INFURA_API_KEY, POOL_ADDRESS, etc.
- See 'sample_env_file'


- Run with ```npx ts-node pool_trial.ts```
- Should output pool info for USDC/WETH 0.3% Pool


***FOR IMPORT ISSUE WITH UNISAWP/PERIPHERAL***

Had the same issue, solved it by cd into the node_modules/@uniswap/v3-periphery, run npm i followed by npx hardhat compile.

Hope this helps.
