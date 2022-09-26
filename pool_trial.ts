import { ethers } from 'ethers'
import { Pool, Position, nearestUsableTick, SqrtPriceMath } from '@uniswap/v3-sdk'
import { Token } from '@uniswap/sdk-core'
import { abi as IUniswapV3PoolABI } from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json'

require('dotenv').config();

const infuraAPIKey = process.env["INFURA_API_KEY"];
const poolAddress = process.env["POOL_ADDRESS"]!

const provider = new ethers.providers.InfuraProvider("homestead", infuraAPIKey);

const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider)

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

async function getNaturalPriceFromSqrt(sqrtPrice) {
  return sqrtPrice ** 2 / 2 ** 192
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

async function main() {
  const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()])

  const TokenA = new Token(3, immutables.token0, 6, 'USDC', 'USD Coin')
  const TokenB = new Token(3, immutables.token1, 18, 'WETH', 'Wrapped Ether')

  const poolExample = new Pool(
    TokenA,
    TokenB,
    immutables.fee,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick
  )
  console.log(poolExample)

  //Self-computed token0 price
  const compPrice = await getNaturalPriceFromSqrt(state.sqrtPriceX96);

  console.log(compPrice);

  const token0Price = poolExample.token0Price
  const token1Price = poolExample.token1Price
  
  console.log(token0Price)
  console.log(token1Price)

  const poolLiquidity = ethers.BigNumber.from(state.liquidity);

  /*
  const position = new Position({
    pool: poolExample,
    liquidity: poolLiquidity * 0.0002,
    tickLower: nearestUsableTick(state.tick, immutables.tickSpacing) - immutables.tickSpacing * 2,
    tickUpper: nearestUsableTick(state.tick, immutables.tickSpacing) + immutables.tickSpacing * 2,
  })
  */

  const numPlusTicks = 20;

  const posTickUpper = nearestUsableTick(state.tick, immutables.tickSpacing) + immutables.tickSpacing * numPlusTicks;

  //console.log(posTickUpper)

  // Calculate price at 'tick'

  const try_ = Math.sqrt(1.0001 ** posTickUpper) * (2 ** 96);

  //console.log(try_)

  //sqrt
  

  //const priceAtTick = getSqrtRatioAtTick(posTickLower)

}

main()