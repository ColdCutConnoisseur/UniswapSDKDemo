import { ethers } from 'ethers'
import { Pool, Position, nearestUsableTick, NonfungiblePositionManager } from '@uniswap/v3-sdk'
import { CurrencyAmount, Token, TradeType, Percent, Fraction } from '@uniswap/sdk-core'
import { AlphaRouter, SwapType, SwapToRatioStatus } from '@uniswap/smart-order-router'
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { abi as QuoterABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'
import { UniswapABI } from './uniswap_abi.json'
import { FactoryABI } from './uni_factory_abi.json'
import { UniswapCoinABI } from './uniswap_coin_abi.json'
import { exit } from 'process'

require('dotenv').config();
const positionConfig = require('./position_config.json')
const erc20abi = require('erc-20-abi')
const axios = require('axios')

const testMode = positionConfig.testMode

// Config
const infuraAPIKey = process.env["INFURA_API_KEY"]
const myWalletAddress = process.env["MY_WALLET_ADDRESS"]
const newPositionLowerLimitDollarMargin = positionConfig.lowerLimitDollarMargin
const newPositionUpperLimitDollarMargin = positionConfig.upperLimitDollarMargin
const newPositionUSDAmount = positionConfig.newPositionTotalUsdAmount

let currentTokenId = parseInt(positionConfig.tokenId)
let myTokenIds = []
let lowerLimitPx: string | null = null
let upperLimitPx: string | null = null

// Contract Addresses
const v3SwapRouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
const uniswapContractAddress = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"

// Set 'provider' and network specific settings
var networkName = "homestead"
var chainId = 1

// Get 'pool' address
// Tokens
let address0 = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  // USDC
let token0Decimals = 6

let address1 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"  // WETH
let token1Decimals = 18

let uniswapDecimalSignificance = 2

const uniswapFactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984"  // NOTE: Same for mainnet

if (testMode) {
  networkName = "goerli"
  chainId = 5
  
  address0 = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"  // Uniswap Coin
  token0Decimals = 18

  address1 = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6"  // goerli WETH

  uniswapDecimalSignificance = 4
}

console.log(`NetworkName: ${networkName}`)

const SUBGRAPH_URL = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3"

const provider = new ethers.providers.InfuraProvider(networkName, infuraAPIKey)

interface Immutables {
  factory: string
  token0: string
  token1: string
  fee: number
  tickSpacing: number
  maxLiquidityPerTick: ethers.BigNumber
}

interface State {
  liquidity: ethers.BigNumber
  sqrtPriceX96: ethers.BigNumber
  tick: number
  observationIndex: number
  observationCardinality: number
  observationCardinalityNext: number
  feeProtocol: number
  unlocked: boolean
}

async function getTokenIds( poolAddress ) {
  const tokenIdsQuery = `{
    positions(where:
      {owner: "${myWalletAddress}",
       pool: "${poolAddress}"})
    {id}
  }`

  const queryResult = await axios.post(SUBGRAPH_URL, { query: tokenIdsQuery })

  const positions = queryResult.data.data.positions

  return positions
}

async function getPoolImmutables(poolContract) {
  const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
    poolContract.factory(),
    poolContract.token0(),
    poolContract.token1(),
    poolContract.fee(),
    poolContract.tickSpacing(),
    poolContract.maxLiquidityPerTick(),
  ])

  const immutables: Immutables = {
    factory,
    token0,
    token1,
    fee,
    tickSpacing,
    maxLiquidityPerTick,
  }
  return immutables
}

async function getPoolState(poolContract) {
  const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()])

  const PoolState: State = {
    liquidity,
    sqrtPriceX96: slot[0],
    tick: slot[1],
    observationIndex: slot[2],
    observationCardinality: slot[3],
    observationCardinalityNext: slot[4],
    feeProtocol: slot[5],
    unlocked: slot[6],
  }

  return PoolState
}
  
function returnCurrentETHPriceGivenTick(currentTick) {
  // This will return ETH / 1 USDC (2 decimals)
  const currentPrice = (1.0001 ** currentTick) / 10 ** (token1Decimals - token0Decimals)

  // Flip it to USDC / ETH
  const currentETHPrice = 1 / currentPrice
  return currentETHPrice.toFixed(uniswapDecimalSignificance)
}

function returnTickMargin(currentTick, limitDollarMargin) {
  const currentETHPrice = returnCurrentETHPriceGivenTick(currentTick)

  const dollarPerTick = parseFloat(currentETHPrice) * 0.0001

  const numTicks = Math.floor(limitDollarMargin / dollarPerTick)

  console.log(`Tick Diff: ${numTicks}`)

  return numTicks
}
  
async function swapAndAddLiquidityAtomically (pool, currentTick, tickSpacing, token0, token1, router) {
  const currentETHPrice = returnCurrentETHPriceGivenTick(currentTick)
  console.log(`Current ETH Price: ${currentETHPrice}`)
  console.log(`Current Tick: ${currentTick}`)

  // Compute upper and lower tick margins
  const lowerTickMargin = returnTickMargin(currentTick, newPositionLowerLimitDollarMargin) // Num ticks
  const upperTickMargin = returnTickMargin(currentTick, newPositionUpperLimitDollarMargin) // ^^

  console.log(`Lower Limit Tick Margin: ${lowerTickMargin}`)
  console.log(`Upper Limit Tick Margin: ${upperTickMargin}`)
  
  // Create a Position Instance
  //    Can set 'liquidity' val to 1 as it will be set later
  const position = new Position({
    pool: pool,
    liquidity: 1,
    tickLower: nearestUsableTick(currentTick - lowerTickMargin, tickSpacing),
    tickUpper: nearestUsableTick(currentTick + upperTickMargin, tickSpacing)
  })

  const USDCAllocatedUSDAmount = Math.floor(0.50 * parseFloat(newPositionUSDAmount))
  const ETHAllocatedUSDAmount = Math.floor(0.50 * parseFloat(newPositionUSDAmount))

  const USDCAmount = USDCAllocatedUSDAmount * (10 ** token0Decimals)
  const ETHAmount = (ETHAllocatedUSDAmount / parseFloat(currentETHPrice)) * (10 ** token1Decimals)

  console.log(`New Position USDC Amount: ${USDCAmount}`)
  console.log(`New Position ETH Amount: ${ETHAmount}`)

  const USDCBalance = CurrencyAmount.fromRawAmount(token0, USDCAmount.toString())
  const ETHBalance = CurrencyAmount.fromRawAmount(token1, ETHAmount.toString())

  let token0Amount = USDCBalance
  let token1Amount = ETHBalance

  if (testMode) {
    const position = new Position({
      pool: pool,
      liquidity: 1,
      tickLower: nearestUsableTick(currentTick, tickSpacing) - tickSpacing * 2,
      tickUpper: nearestUsableTick(currentTick, tickSpacing) + tickSpacing * 2
    })

    token0Amount = CurrencyAmount.fromRawAmount(token0, "7744340000000000")
    token1Amount = CurrencyAmount.fromRawAmount(token1, "5000000000000000")
  }

  const signer = new ethers.Wallet(process.env.SIGNER_PK, provider);

  // Set Coin Approvals
  const token0Contract = new ethers.Contract(address0, erc20abi, provider)
  const token1Contract = new ethers.Contract(address1, erc20abi, provider)

  const approval0Response = await token0Contract.connect(signer).approve(
    v3SwapRouterAddress,
    "1000000000000000000"
  )

  const approval1Response = await token1Contract.connect(signer).approve(
    v3SwapRouterAddress,
    "1000000000000000000"
  )

  // NOTE: Also need to wrap ETH if only ETH or 'useNative' flag in 'addLiquidityOptions'

  const routeToRatioResponse = await router.routeToRatio(
    token0Amount,
    token1Amount,
    position,
    {
      maxIterations: 6,
      ratioErrorTolerance: new Fraction(5, 100)
    },
    {
      swapOptions: {
        recipient: myWalletAddress,
        slippageTolerance: new Percent(5, 100),   // Was 5%  TODO: CHANGE BACK!
        deadline: Math.floor(Date.now() / 1000 + 1800),
        //inputTokenPermit: inputTokenPermit, //{value: "1000000000000000000", deadline: Math.floor(Date.now() / 1000) + 86400} //Math.floor(Date.now() / 1000 + 1800)}
      },
      addLiquidityOptions: {
        recipient: myWalletAddress,
        useNative: true
      }
    }
  )

  if (routeToRatioResponse.status == SwapToRatioStatus.SUCCESS) {
    console.log("SwapToRatio Successful!")

    const route = routeToRatioResponse.result

    //console.log(`Debug| gasPrice: ${ethers.BigNumber.from(route.gasPriceWei)}`)

    const transaction = {
      data: route.methodParameters.calldata,
      to: v3SwapRouterAddress,
      value: ethers.BigNumber.from(route.methodParameters.value),
      from: myWalletAddress,
      gasPrice: ethers.BigNumber.from(route.gasPriceWei),
      gasLimit: 5000000
    }

    const txnResult = await (await signer.sendTransaction(transaction)).wait(2);

    console.log(txnResult)
    console.log("Multicall finished!")

    return [position.tickLower, position.tickUpper]
  }

  else {
    console.log("Unsuccessful swap + mint call")
  }
}

async function swapAndCreateNewPosition(poolContract, token0, token1) {
  console.log("Swapping and minting atomically...")
  const [currentImmutables, currentState] = await Promise.all([getPoolImmutables(poolContract), getPoolState(poolContract)])

  const currentPool = new Pool(
    token0,
    token1,
    currentImmutables.fee,
    currentState.sqrtPriceX96.toString(),
    currentState.liquidity.toString(),
    currentState.tick
  )

  const router = new AlphaRouter({ chainId: chainId, provider: provider})

  swapAndAddLiquidityAtomically (currentPool, currentState.tick, currentImmutables.tickSpacing, token0, token1, router)
}

async function liquidateCurrentPosition(position, token0, token1, poolContract) {
  console.log("Liquidating current position...")
  //const token0Owed = positionToRemove.tokensOwed0.toBigInt()
  //const token1Owed = positionToRemove.tokensOwed1.toBigInt()

  //console.log(token0Owed)

  const [currentImmutables, currentState] = await Promise.all([getPoolImmutables(poolContract), getPoolState(poolContract)])

  const positionLiquidityVal = position.liquidity.toString()

  const currentPool = new Pool(
    token0,
    token1,
    currentImmutables.fee,
    currentState.sqrtPriceX96.toString(),
    currentState.liquidity.toString(),
    currentState.tick
  )

  const positionToRemove = new Position({
    pool: currentPool,
    liquidity: positionLiquidityVal,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper
  })
  
  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(positionToRemove, {
    tokenId: currentTokenId,
    liquidityPercentage: new Percent(1),            // 100% of position
    slippageTolerance: new Percent(1, 100),
    deadline: Math.floor((Date.now() / 1000) + 1800),
    collectOptions: {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(token0, 0),    // Prevent re-entry attacks
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(token1, 0),
      recipient: myWalletAddress,
    },
  })

  const transaction = {
    data: calldata,
    to: uniswapContractAddress,
    value: ethers.BigNumber.from(value),
    from: myWalletAddress
  }

  const signer = new ethers.Wallet(process.env.SIGNER_PK, provider);

  const txnResult = await (await signer.sendTransaction(transaction)).wait(2);

  return txnResult.status
}

async function currentPoolPriceWithinLimits(poolContract) {
  // Returns Bool: Is position within upper and lower price limits?

  const state = await getPoolState(poolContract)

  const currentETHPrice = parseFloat(returnCurrentETHPriceGivenTick(state.tick))
  console.log(`Current pool ETH price: ${currentETHPrice}`)

  console.log(`UpperLimitPx: ${upperLimitPx}`)
  console.log(`LowerLimitPx: ${lowerLimitPx}`)

  const upperBreach = currentETHPrice > parseFloat(upperLimitPx)
  const lowerBreach = currentETHPrice < parseFloat(lowerLimitPx)

  console.log(`LowerLimitBreach: ${lowerBreach}`)
  console.log(`UpperLimitBreach: ${upperBreach}`)

  if ((!upperBreach) && (!lowerBreach)) {
    console.log("Position is within limits")
    return true
  }

  else {
    console.log("Position out of limits!")
    return false
  }
}

function delay(ms) {
  // 'Sleep' function
  console.log("Sleep started")
  return new Promise( resolve => setTimeout(resolve, ms) );
}

async function runPositionLoop() {
  // main

  // Create 'contract' objects
  const factoryContract = new ethers.Contract(uniswapFactoryAddress, FactoryABI, provider)
  const positionContract = new ethers.Contract(uniswapContractAddress, UniswapABI, provider)
  const feeTier = positionConfig.feeTier

  const poolAddress = await factoryContract.getPool(address0, address1, feeTier)

  console.log(`poolAddress: ${poolAddress}`)

  myTokenIds = await getTokenIds( poolAddress )

  console.log(`My Token Ids: ${myTokenIds}`)

  const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider)

  let [immutables, state] = await Promise.all([getPoolImmutables(poolContract), getPoolState(poolContract)])

  var position = await positionContract.positions(currentTokenId)

  upperLimitPx = returnCurrentETHPriceGivenTick(position.tickLower) // UpperPrice --> Lower tick because quote asset
  lowerLimitPx = returnCurrentETHPriceGivenTick(position.tickUpper)

  console.log(`Position Lower Price Limit: ${lowerLimitPx}`)
  console.log(`Position Upper Price Limit: ${upperLimitPx}`)

  // Create Token Objects
  const token0 = new Token(chainId, address0, token0Decimals)
  const token1 = new Token(chainId, address1, token1Decimals)

  const shouldRun = true
  
  while (shouldRun) {
    const positionGood = await currentPoolPriceWithinLimits(poolContract)
    console.log(`PositionGood?: ${positionGood}`)


    if (!positionGood) {
      position = await positionContract.positions(currentTokenId)

      //console.log(position)

      await liquidateCurrentPosition(position, token0, token1, poolContract)
      var positionTickLower, positionTickUpper = await swapAndCreateNewPosition(poolContract, token0, token1)

      // Reset Position Limits
      upperLimitPx = returnCurrentETHPriceGivenTick(positionTickLower) // UpperPrice --> Lower tick because quote asset
      lowerLimitPx = returnCurrentETHPriceGivenTick(positionTickUpper)

      // Update TokenId
      const newTokenIdsList = await getTokenIds(poolAddress)

      for (let i = 0; newTokenIdsList.length; i++) {
        var inspectId = newTokenIdsList[i]

        if (!(inspectId in myTokenIds)) {
          currentTokenId = inspectId
        }
      }

      myTokenIds = newTokenIdsList
    }
    
    else {
      console.log("Sleeping for 30 seconds...")
      await delay(30000).then(() => {
        console.log("Sleep Exited!")
      });
    }
  }

}


runPositionLoop()

