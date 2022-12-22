import { ethers } from 'ethers'
import { Pool, Position, nearestUsableTick, NonfungiblePositionManager } from '@uniswap/v3-sdk'
import { CurrencyAmount, Token, TradeType, Percent, Fraction } from '@uniswap/sdk-core'
import { AlphaRouter, SwapType, SwapToRatioStatus } from '@uniswap/smart-order-router'
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'
import { abi as QuoterABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json'
import { UniswapABI } from './uniswap_abi.json'
import { exit } from 'process'

require('dotenv').config();
const positionConfig = require('./position_config.json')

const testMode = positionConfig.testMode

// Config
const infuraAPIKey = process.env["INFURA_API_KEY"]
const myWalletAddress = process.env["MY_WALLET_ADDRESS"]
const poolAddress = positionConfig.poolAddress
const newPositionLowerLimitDollarMargin = positionConfig.lowerLimitDollarMargin
const newPositionUpperLimitDollarMargin = positionConfig.upperLimitDollarMargin
const newPositionUSDAmount = positionConfig.newPositionTotalUsdAmount

let currentTokenId = parseInt(positionConfig.tokenId)
let lowerLimitPx = parseFloat(positionConfig.lowerLimitPrice)
let upperLimitPx = parseFloat(positionConfig.upperLimitPrice)

// Contract Addresses
const quoterAddress = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
const v3SwapRouterAddress = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
const uniswapContractAddress = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"

// Set 'provider' and network specific settings
var networkName = "homestead"
var chainId = 1

if (testMode) {
  networkName = "goerli"
  chainId = 5
}

console.log(`NetworkName: ${networkName}`)

const provider = new ethers.providers.InfuraProvider(networkName, infuraAPIKey)

// Create contract objects
const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider)
const positionContract = new ethers.Contract(uniswapContractAddress, UniswapABI, provider)

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

async function getPoolImmutables() {
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

async function getPoolState() {
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
  const currentPrice = (1.0001 ** currentTick) / 10 ** 12 //ETH Decimals - USDC Decimals

  // Flip it to USDC / ETH
  const currentETHPrice = 1 / currentPrice
  return currentETHPrice.toFixed(2)
}

function returnTickMargin(currentTick, limitDollarMargin) {
  const currentETHPrice = returnCurrentETHPriceGivenTick(currentTick)

  const dollarPerTick = parseFloat(currentETHPrice) * 0.0001

  const numTicks = Math.floor(limitDollarMargin / dollarPerTick)

  console.log(`Tick Diff: ${numTicks}`)

  return numTicks
}
  
async function swapAndAddLiquidityAtomically (pool, currentTick, tickSpacing, USDC, WETH, router) {
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

  const USDCAmount = USDCAllocatedUSDAmount * (10 ** 6)
  const ETHAmount = (ETHAllocatedUSDAmount / parseFloat(currentETHPrice)) * (10 ** 18)

  console.log(`New Position USDC Amount: ${USDCAmount}`)
  console.log(`New Position ETH Amount: ${ETHAmount}`)

  const USDCBalance = CurrencyAmount.fromRawAmount(USDC, USDCAmount.toString())
  const ETHBalance = CurrencyAmount.fromRawAmount(WETH, ETHAmount)

  const routeToRatioResponse = await router.routeToRatio(
    USDCBalance,
    ETHBalance,
    position,
    {
      maxIterations: 6,
      ratioErrorTolerance: new Fraction(1, 100)
    },
    {
      swapConfig: {
        recipient: myWalletAddress,
        slippage: new Percent(5, 100),
        deadline: Math.floor(Date.now() / 1000 + 1800)
      },
      addLiquidityOptions: {
        recipient: myWalletAddress
      }
    }
  )

  if (routeToRatioResponse.status == SwapToRatioStatus.SUCCESS) {
    console.log("Great Success!")

    console.log(routeToRatioResponse)

    const route = routeToRatioResponse.result
    const transaction = {
      data: route.methodParameters.calldata,
      to: v3SwapRouterAddress,
      value: ethers.BigNumber.from(route.methodParameters.value),
      from: myWalletAddress,
      gasPrice: ethers.BigNumber.from(route.gasPriceWei),
    }

    const signer = new ethers.Wallet(process.env.SIGNER_PK, provider);

    const txnResult = await signer.sendTransaction(transaction);

    console.log(txnResult)

    console.log("TODO: Set new tokenId and change upper/lower price limits!")
  }
}

async function swapAndCreateNewPosition() {

  const[immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()])

  const USDC = new Token(chainId, immutables.token0, 6, 'USDC', 'USD Coin')
  const WETH = new Token(chainId, immutables.token1, 18, 'WETH', 'Wrapped Ether')

  const USDC_WETH_POOL = new Pool(
    USDC,
    WETH,
    immutables.fee,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick
  )

  const router = new AlphaRouter({ chainId: chainId, provider: provider})

  swapAndAddLiquidityAtomically (USDC_WETH_POOL, state.tick, immutables.tickSpacing, USDC, WETH, router)
}

async function liquidateCurrentPosition(positionToRemove) {
  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(positionToRemove, {
    tokenId: currentTokenId,
    liquidityPercentage: new Percent(1),            // 100% of position
    slippageTolerance: new Percent(50, 10_000),
    deadline: Math.floor(Date.now() / 1000 + 1800),
    collectOptions: {
      expectedCurrencyOwed0: positionToRemove.tokensOwed0,
      expectedCurrencyOwed1: positionToRemove.tokensOwed1,
      recipient: myWalletAddress,
    },
  })
}

async function currentPoolPriceWithinLimits() {
  // Returns Bool: Is position within upper and lower price limits?
  const state = await getPoolState()

  const currentETHPrice = parseFloat(returnCurrentETHPriceGivenTick(state.tick))
  console.log(`Current pool ETH price: ${currentETHPrice}`)

  console.log(`UpperLimitPx: ${upperLimitPx}`)
  console.log(`LowerLimitPx: ${lowerLimitPx}`)

  const upperBreach = currentETHPrice > upperLimitPx
  const lowerBreach = currentETHPrice < lowerLimitPx

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
  return new Promise( resolve => setTimeout(resolve, ms) );
}

async function runPositionLoop() {
  // main

  var position = await positionContract.positions(currentTokenId)

  const shouldRun = true

  while (shouldRun) {
    const positionGood = await currentPoolPriceWithinLimits()
    console.log(`PositionGood?: ${positionGood}`)

    if (!positionGood) {
      console.log("Liquidating current position...")
      position = await positionContract.positions(currentTokenId) // Update Position
      liquidateCurrentPosition(position)
      console.log("Position Liquidated")

      console.log("Swapping and creating new position...")
      swapAndCreateNewPosition()
      console.log("New position created")

    }

    console.log("Sleeping for 30 seconds...")
    await delay(30000)
    console.log("Sleep exited")
  }
  
}


// runPositionLoop()

swapAndCreateNewPosition()