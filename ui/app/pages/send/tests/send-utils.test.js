import assert from 'assert'
import sinon from 'sinon'
import proxyquire from 'proxyquire'
import {
  BASE_TOKEN_GAS_COST,
  SIMPLE_GAS_COST,
  INSUFFICIENT_FUNDS_ERROR,
  INSUFFICIENT_TOKENS_ERROR,
} from '../send.constants'

const stubs = {
  addCurrencies: sinon.stub().callsFake((a, b) => {
    if (String(a).match(/^0x.+/)) {
      a = Number(String(a).slice(2))
    }
    if (String(b).match(/^0x.+/)) {
      b = Number(String(b).slice(2))
    }
    return a + b
  }),
  conversionUtil: sinon.stub().callsFake((val) => parseInt(val, 16)),
  conversionGTE: sinon
    .stub()
    .callsFake((obj1, obj2) => obj1.value >= obj2.value),
  multiplyCurrencies: sinon.stub().callsFake((a, b) => `${a}x${b}`),
  calcTokenAmount: sinon.stub().callsFake((a, d) => 'calc:' + a + d),
  rawEncode: sinon.stub().returns([16, 1100]),
  conversionGreaterThan: sinon
    .stub()
    .callsFake((obj1, obj2) => obj1.value > obj2.value),
  conversionLessThan: sinon
    .stub()
    .callsFake((obj1, obj2) => obj1.value < obj2.value),
}

const sendUtils = proxyquire('../send.utils.js', {
  '../../helpers/utils/conversion-util': {
    addCurrencies: stubs.addCurrencies,
    conversionUtil: stubs.conversionUtil,
    conversionGTE: stubs.conversionGTE,
    multiplyCurrencies: stubs.multiplyCurrencies,
    conversionGreaterThan: stubs.conversionGreaterThan,
    conversionLessThan: stubs.conversionLessThan,
  },
  '../../helpers/utils/token-util': { calcTokenAmount: stubs.calcTokenAmount },
  'ethereumjs-abi': {
    rawEncode: stubs.rawEncode,
  },
})

const {
  calcGasTotal,
  estimateGasAndCollateral,
  doesAmountErrorRequireUpdate,
  generateTokenTransferData,
  getAmountErrorObject,
  getGasFeeErrorObject,
  getToAddressForGasUpdate,
  calcTokenBalance,
  isBalanceSufficient,
  isTokenBalanceSufficient,
  removeLeadingZeroes,
} = sendUtils

describe('send utils', function () {
  describe('calcGasTotal()', function () {
    it('should call multiplyCurrencies with the correct params and return the multiplyCurrencies return', function () {
      const result = calcGasTotal(12, 15)
      assert.equal(result, '12x15')
      const call_ = stubs.multiplyCurrencies.getCall(0).args
      assert.deepEqual(call_, [
        12,
        15,
        {
          toNumericBase: 'hex',
          multiplicandBase: 16,
          multiplierBase: 16,
        },
      ])
    })
  })

  describe('doesAmountErrorRequireUpdate()', function () {
    const config = {
      'should return true if balances are different': {
        balance: 0,
        prevBalance: 1,
        expectedResult: true,
      },
      'should return true if gasTotals are different': {
        gasTotal: 0,
        prevGasTotal: 1,
        expectedResult: true,
      },
      'should return true if storageTotals are different': {
        storageTotal: 0,
        prevStorageTotal: 1,
        expectedResult: true,
      },
      'should return true if token balances are different': {
        tokenBalance: 0,
        prevTokenBalance: 1,
        selectedToken: 'someToken',
        expectedResult: true,
      },
      'should return false if they are all the same': {
        balance: 1,
        prevBalance: 1,
        storageTotal: 1,
        prevStorageTotal: 1,
        gasTotal: 1,
        prevGasTotal: 1,
        tokenBalance: 1,
        prevTokenBalance: 1,
        selectedToken: 'someToken',
        expectedResult: false,
      },
    }
    Object.entries(config).map(([description, obj]) => {
      it(description, function () {
        assert.equal(doesAmountErrorRequireUpdate(obj), obj.expectedResult)
      })
    })
  })

  describe('generateTokenTransferData()', function () {
    it('should return undefined if not passed a selected token', function () {
      assert.equal(
        generateTokenTransferData({
          toAddress: 'mockAddress',
          amount: '0xa',
          selectedToken: false,
        }),
        undefined
      )
    })

    it('should call abi.rawEncode with the correct params', function () {
      stubs.rawEncode.resetHistory()
      generateTokenTransferData({
        toAddress: 'mockAddress',
        amount: 'ab',
        selectedToken: true,
      })
      assert.deepEqual(stubs.rawEncode.getCall(0).args, [
        ['address', 'uint256'],
        ['mockAddress', '0xab'],
      ])
    })

    it('should return encoded token transfer data', function () {
      assert.equal(
        generateTokenTransferData({
          toAddress: 'mockAddress',
          amount: '0xa',
          selectedToken: true,
        }),
        '0xa9059cbb104c'
      )
    })
  })

  describe('getAmountErrorObject()', function () {
    const config = {
      'should return insufficientFunds error if isBalanceSufficient returns false': {
        amount: 15,
        amountConversionRate: 2,
        balance: 1,
        conversionRate: 3,
        gasTotal: 17,
        primaryCurrency: 'ABC',
        expectedResult: { amount: INSUFFICIENT_FUNDS_ERROR },
      },
      'should not return insufficientFunds error if selectedToken is truthy': {
        amount: '0x0',
        amountConversionRate: 2,
        balance: 1,
        conversionRate: 3,
        gasTotal: 17,
        primaryCurrency: 'ABC',
        selectedToken: { symbole: 'DEF', decimals: 0 },
        decimals: 0,
        tokenBalance: 'sometokenbalance',
        expectedResult: { amount: null },
      },
      'should return insufficientTokens error if token is selected and isTokenBalanceSufficient returns false': {
        amount: '0x10',
        amountConversionRate: 2,
        balance: 100,
        conversionRate: 3,
        decimals: 10,
        gasTotal: 17,
        primaryCurrency: 'ABC',
        selectedToken: 'someToken',
        tokenBalance: 123,
        expectedResult: { amount: INSUFFICIENT_TOKENS_ERROR },
      },
    }
    Object.entries(config).map(([description, obj]) => {
      it(description, function () {
        assert.deepEqual(getAmountErrorObject(obj), obj.expectedResult)
      })
    })
  })

  describe('getGasFeeErrorObject()', function () {
    const config = {
      'should return insufficientFunds error if isBalanceSufficient returns false': {
        amountConversionRate: 2,
        balance: 16,
        conversionRate: 3,
        gasTotal: 17,
        primaryCurrency: 'ABC',
        expectedResult: { gasAndCollateralFee: INSUFFICIENT_FUNDS_ERROR },
      },
      'should return null error if isBalanceSufficient returns true': {
        amountConversionRate: 2,
        balance: 16,
        conversionRate: 3,
        gasTotal: 15,
        primaryCurrency: 'ABC',
        expectedResult: { gasAndCollateralFee: null },
      },
    }
    Object.entries(config).map(([description, obj]) => {
      it(description, function () {
        assert.deepEqual(getGasFeeErrorObject(obj), obj.expectedResult)
      })
    })
  })

  describe('calcTokenBalance()', function () {
    it('should return the calculated token blance', function () {
      assert.equal(
        calcTokenBalance({
          selectedToken: {
            decimals: 11,
          },
          usersToken: {
            balance: 20,
          },
        }),
        'calc:2011'
      )
    })
  })

  describe('isBalanceSufficient()', function () {
    it('should correctly call addCurrencies and return the result of calling conversionGTE', function () {
      stubs.conversionGTE.resetHistory()
      const result = isBalanceSufficient({
        amount: 15,
        amountConversionRate: 2,
        balance: 100,
        conversionRate: 3,
        gasTotal: 17,
        primaryCurrency: 'ABC',
      })
      assert.deepEqual(stubs.addCurrencies.getCall(0).args, [
        15,
        17,
        {
          aBase: 16,
          bBase: 16,
          toNumericBase: 'hex',
        },
      ])
      assert.deepEqual(stubs.conversionGTE.getCall(0).args, [
        {
          value: 100,
          fromNumericBase: 'hex',
          fromCurrency: 'ABC',
          conversionRate: 3,
        },
        {
          value: 32,
          fromNumericBase: 'hex',
          conversionRate: 2,
          fromCurrency: 'ABC',
        },
      ])

      assert.equal(result, true)
    })
  })

  describe('isTokenBalanceSufficient()', function () {
    it('should correctly call conversionUtil and return the result of calling conversionGTE', function () {
      stubs.conversionGTE.resetHistory()
      stubs.conversionUtil.resetHistory()
      const result = isTokenBalanceSufficient({
        amount: '0x10',
        tokenBalance: 123,
        decimals: 10,
      })
      assert.deepEqual(stubs.conversionUtil.getCall(0).args, [
        '0x10',
        {
          fromNumericBase: 'hex',
        },
      ])
      assert.deepEqual(stubs.conversionGTE.getCall(0).args, [
        {
          value: 123,
          fromNumericBase: 'hex',
        },
        {
          value: 'calc:1610',
        },
      ])

      assert.equal(result, false)
    })
  })

  describe('estimateGasAndCollateral', function () {
    const baseMockParams = {
      blockGasLimit: '0x64',
      selectedAddress: 'mockAddress',
      to: '0x8isContract',
      estimateGasAndCollateralMethod: sinon.stub().callsFake(({ to }, cb) => {
        const err =
          typeof to === 'string' && to.match(/willFailBecauseOf:/)
            ? new Error(to.match(/:(.+)$/)[1])
            : null
        const result = {
          gasUsed: { toString: (n) => `0xabc${n}` },
          storageCollateralized: '0x30',
        }
        return cb(err, result)
      }),
    }
    const baseExpectedCall = {
      from: 'mockAddress',
      gas: '0x64x0.95',
      to: '0x8isContract',
      value: '0xff',
    }

    beforeEach(function () {
      global.eth = {
        getCode: sinon
          .stub()
          .callsFake((address) =>
            Promise.resolve(address.match(/isContract/) ? 'not-0x' : '0x')
          ),
      }
    })

    afterEach(function () {
      baseMockParams.estimateGasAndCollateralMethod.resetHistory()
      global.eth.getCode.resetHistory()
    })

    it('should call ethQuery.estimateGas with the expected params', async function () {
      const result = await sendUtils.estimateGasAndCollateral(baseMockParams)
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 1)
      assert.deepEqual(
        baseMockParams.estimateGasAndCollateralMethod.getCall(0).args[0],
        Object.assign(
          { gasPrice: undefined, value: undefined },
          baseExpectedCall
        )
      )
      assert.deepEqual(result, { gas: '0xabc16', storageLimit: '0x30' })
    })

    it('should call ethQuery.estimateGas with the expected params when initialGasLimitHex is lower than the upperGasLimit', async function () {
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, { blockGasLimit: '0xbcd' })
      )
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 1)
      assert.deepEqual(
        baseMockParams.estimateGasAndCollateralMethod.getCall(0).args[0],
        Object.assign(
          { gasPrice: undefined, value: undefined },
          baseExpectedCall,
          { gas: '0xbcdx0.95' }
        )
      )
      assert.deepEqual(result, { gas: '0xabc16x1.5', storageLimit: '0x30' })
    })

    it('should call ethQuery.estimateGas with a value of 0x0 and the expected data and to if passed a selectedToken', async function () {
      const result = await estimateGasAndCollateral(
        Object.assign(
          { data: 'mockData', selectedToken: { address: 'mockAddress' } },
          baseMockParams
        )
      )
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 1)
      assert.deepEqual(
        baseMockParams.estimateGasAndCollateralMethod.getCall(0).args[0],
        Object.assign({}, baseExpectedCall, {
          gasPrice: undefined,
          value: '0x0',
          data: '0xa9059cbb104c',
          to: 'mockAddress',
        })
      )
      assert.deepEqual(result, { gas: '0xabc16', storageLimit: '0x30' })
    })

    it('should call ethQuery.estimateGas without a recipient if the recipient is empty and data passed', async function () {
      const data = 'mockData'
      const to = ''
      const result = await estimateGasAndCollateral({ ...baseMockParams, data, to })
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 1)
      assert.deepEqual(baseMockParams.estimateGasAndCollateralMethod.getCall(0).args[0], {
        gasPrice: undefined,
        value: '0xff',
        data,
        from: baseExpectedCall.from,
        gas: baseExpectedCall.gas,
      })
      assert.deepEqual(result, { gas: '0xabc16', storageLimit: '0x30' })
    })

    it(`should return ${SIMPLE_GAS_COST} if ethQuery.getCode does not return '0x'`, async function () {
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 0)
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, { to: '0x123' })
      )
      assert.deepEqual(result, { gas: '0x5208', storageLimit: '0x0' })
    })

    it(`should return ${SIMPLE_GAS_COST} if not passed a selectedToken or truthy to address`, async function () {
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 0)
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, { to: null })
      )
      assert.deepEqual(result, { gas: '0x5208', storageLimit: '0x0' })
    })

    it(`should not return ${SIMPLE_GAS_COST} if passed a selectedToken`, async function () {
      assert.equal(baseMockParams.estimateGasAndCollateralMethod.callCount, 0)
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, {
          to: '0x123',
          selectedToken: { address: '' },
        })
      )
      assert.deepEqual(result, { gas: '0xabc16', storageLimit: '0x30' })
    })

    // we plan to support tokens other than erc20 token
    it.skip(`should return ${BASE_TOKEN_GAS_COST} if passed a selectedToken but no to address`, async function () {
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, {
          to: null,
          selectedToken: { address: '0x8isContract' },
        })
      )
      assert.deepEqual(result, { gas: BASE_TOKEN_GAS_COST, storageLimit: '0x39' })
    })

    it(`should return the adjusted blockGasLimit if it fails with a 'Transaction execution error.'`, async function () {
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, {
          to: 'isContract willFailBecauseOf:Transaction execution error.',
        })
      )
      assert.equal(result, '0x64x0.95')
    })

    it(`should return the adjusted blockGasLimit if it fails with a 'gas required exceeds allowance or always failing transaction.'`, async function () {
      const result = await estimateGasAndCollateral(
        Object.assign({}, baseMockParams, {
          to:
            'isContract willFailBecauseOf:gas required exceeds allowance or always failing transaction.',
        })
      )
      assert.equal(result, '0x64x0.95')
    })

    it(`should reject other errors`, async function () {
      try {
        await estimateGasAndCollateral(
          Object.assign({}, baseMockParams, {
            to: 'isContract willFailBecauseOf:some other error',
          })
        )
      } catch (err) {
        assert.equal(err.message, 'some other error')
      }
    })
  })

  // describe.skip('estimateGasPriceFromRecentBlocks', function () {
  //   const ONE_GWEI_IN_WEI_HEX_PLUS_ONE = addCurrencies(
  //     ONE_GWEI_IN_WEI_HEX,
  //     '0x1',
  //     {
  //       aBase: 16,
  //       bBase: 16,
  //       toNumericBase: 'hex',
  //     }
  //   )
  //   const ONE_GWEI_IN_WEI_HEX_PLUS_TWO = addCurrencies(
  //     ONE_GWEI_IN_WEI_HEX,
  //     '0x2',
  //     {
  //       aBase: 16,
  //       bBase: 16,
  //       toNumericBase: 'hex',
  //     }
  //   )
  //   const ONE_GWEI_IN_WEI_HEX_MINUS_ONE = subtractCurrencies(
  //     ONE_GWEI_IN_WEI_HEX,
  //     '0x1',
  //     {
  //       aBase: 16,
  //       bBase: 16,
  //       toNumericBase: 'hex',
  //     }
  //   )

  //   it(`should return ${ONE_GWEI_IN_WEI_HEX} if recentBlocks is falsy`, function () {
  //     assert.equal(estimateGasPriceFromRecentBlocks(), ONE_GWEI_IN_WEI_HEX)
  //   })

  //   it(`should return ${ONE_GWEI_IN_WEI_HEX} if recentBlocks is empty`, function () {
  //     assert.equal(estimateGasPriceFromRecentBlocks([]), ONE_GWEI_IN_WEI_HEX)
  //   })

  //   it(`should estimate a block's gasPrice as ${ONE_GWEI_IN_WEI_HEX} if it has no gas prices`, function () {
  //     const mockRecentBlocks = [
  //       { gasPrices: null },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_PLUS_ONE] },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_MINUS_ONE] },
  //     ]
  //     assert.equal(
  //       estimateGasPriceFromRecentBlocks(mockRecentBlocks),
  //       ONE_GWEI_IN_WEI_HEX
  //     )
  //   })

  //   it(`should estimate a block's gasPrice as ${ONE_GWEI_IN_WEI_HEX} if it has empty gas prices`, function () {
  //     const mockRecentBlocks = [
  //       { gasPrices: [] },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_PLUS_ONE] },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_MINUS_ONE] },
  //     ]
  //     assert.equal(
  //       estimateGasPriceFromRecentBlocks(mockRecentBlocks),
  //       ONE_GWEI_IN_WEI_HEX
  //     )
  //   })

  //   it(`should return the middle value of all blocks lowest prices`, function () {
  //     const mockRecentBlocks = [
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_PLUS_TWO] },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_MINUS_ONE] },
  //       { gasPrices: [ONE_GWEI_IN_WEI_HEX_PLUS_ONE] },
  //     ]
  //     assert.equal(
  //       estimateGasPriceFromRecentBlocks(mockRecentBlocks),
  //       ONE_GWEI_IN_WEI_HEX_PLUS_ONE
  //     )
  //   })

  //   it(`should work if a block has multiple gas prices`, function () {
  //     const mockRecentBlocks = [
  //       { gasPrices: ['0x1', '0x2', '0x3', '0x4', '0x5'] },
  //       { gasPrices: ['0x101', '0x100', '0x103', '0x104', '0x102'] },
  //       { gasPrices: ['0x150', '0x50', '0x100', '0x200', '0x5'] },
  //     ]
  //     assert.equal(estimateGasPriceFromRecentBlocks(mockRecentBlocks), '0x5')
  //   })
  // })

  describe('getToAddressForGasUpdate()', function () {
    it('should return empty string if all params are undefined or null', function () {
      assert.equal(getToAddressForGasUpdate(undefined, null), '')
    })

    it('should return the first string that is not defined or null in lower case', function () {
      assert.equal(getToAddressForGasUpdate('A', null), 'a')
      assert.equal(getToAddressForGasUpdate(undefined, 'B'), 'b')
    })
  })

  describe('removeLeadingZeroes()', function () {
    it('should remove leading zeroes from int when user types', function () {
      assert.equal(removeLeadingZeroes('0'), '0')
      assert.equal(removeLeadingZeroes('1'), '1')
      assert.equal(removeLeadingZeroes('00'), '0')
      assert.equal(removeLeadingZeroes('01'), '1')
    })

    it('should remove leading zeroes from int when user copy/paste', function () {
      assert.equal(removeLeadingZeroes('001'), '1')
    })

    it('should remove leading zeroes from float when user types', function () {
      assert.equal(removeLeadingZeroes('0.'), '0.')
      assert.equal(removeLeadingZeroes('0.0'), '0.0')
      assert.equal(removeLeadingZeroes('0.00'), '0.00')
      assert.equal(removeLeadingZeroes('0.001'), '0.001')
      assert.equal(removeLeadingZeroes('0.10'), '0.10')
    })

    it('should remove leading zeroes from float when user copy/paste', function () {
      assert.equal(removeLeadingZeroes('00.1'), '0.1')
    })
  })
})
