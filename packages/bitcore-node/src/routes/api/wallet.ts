import { Validation } from 'crypto-wallet-core';
import { Request, Response, Router } from 'express';
import logger from '../../logger';
import { ChainStateProvider } from '../../providers/chain-state';
import { StreamWalletAddressesParams } from '../../types/namespaces/ChainStateProvider';
import { Auth, AuthenticatedRequest } from '../../utils/auth';
import config from '../../config';
const router = Router({ mergeParams: true });

function isTooLong(field, maxLength = 255) {
  return field && field.toString().length >= maxLength;
}
// create wallet
router.post('/', async function(req: Request, res: Response) {
  try {
    let { chain, network } = req.params;
    let { name, pubKey, path, singleAddress } = req.body;

    const existingWallet = await ChainStateProvider.getWallet({
      chain,
      network,
      pubKey
    });
    if (existingWallet) {
      return res.status(200).send('Wallet already exists');
    }
    if (isTooLong(name) || isTooLong(pubKey) || isTooLong(path) || isTooLong(singleAddress)) {
      return res.status(413).send('String length exceeds limit');
    }
    let result = await ChainStateProvider.createWallet({
      chain,
      network,
      singleAddress,
      name,
      pubKey,
      path
    });
    return res.send(result);
  } catch (err: any) {
    logger.error('Error getting wallet: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey/addresses/missing', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    let { chain, network, pubKey } = req.params;
    let payload = {
      chain,
      network,
      pubKey,
      res
    };
    return await ChainStateProvider.streamMissingWalletAddresses(payload);
  } catch (err: any) {
    logger.error('Error streaming missing wallets: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey/addresses', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { wallet } = req;
    let { chain, network } = req.params;
    let { limit } = req.query as any;
    let payload: StreamWalletAddressesParams = {
      chain,
      network,
      walletId: wallet!._id!,
      limit,
      req,
      res
    };
    return await ChainStateProvider.streamWalletAddresses(payload);
  } catch (err: any) {
    logger.error('Error streaming wallet addresses: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey/check', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let { chain, network } = req.params;
    const wallet = req.wallet!._id!;
    const result = await ChainStateProvider.walletCheck({
      chain,
      network,
      wallet
    });
    return res.send(result);
  } catch (err: any) {
    logger.error('Error checking wallet: %o', err.stack || err.message || err);
    return res.status(500).json(err);
  }
});

// update wallet
router.post('/:pubKey', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  let keepAlive;
  try {
    const { chain, network, pubKey } = req.params;
    const addressLines: { address: string }[] = req.body.filter(line => !!line.address);

    const addresses = addressLines.map(({ address }) => address);
    for (const address of addresses) {
      if (isTooLong(address) || !Validation.validateAddress(chain, network, address)) {
        return res.status(413).send('Invalid address');
      }
    }
    let reprocess = false;
    if (req.headers['x-reprocess']) {
      const reprocessOk = Auth.verifyRequestSignature({
        message: ['reprocess', '/addAddresses' + pubKey, JSON.stringify(req.body)].join('|'),
        pubKey: config.services.socket.bwsKeys[0],
        signature: req.headers['x-reprocess']
      });
      if (!reprocessOk) {
        return res.status(401).send('Authentication failed');
      }
      reprocess = true;
    }
    res.status(200);
    keepAlive = setInterval(() => {
      res.write('\n');
    }, 1000);
    await ChainStateProvider.updateWallet({
      chain,
      network,
      wallet: req.wallet!,
      addresses,
      reprocess
    });
    clearInterval(keepAlive);
    return res.end();
  } catch (err: any) {
    clearInterval(keepAlive);
    logger.error('Error updating wallet: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey/transactions', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let { chain, network } = req.params;
    return await ChainStateProvider.streamWalletTransactions({
      chain,
      network,
      wallet: req.wallet!,
      req,
      res,
      args: req.query
    });
  } catch (err: any) {
    logger.error('Error streaming wallet txs: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey/balance', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  let { chain, network } = req.params;
  try {
    const result = await ChainStateProvider.getWalletBalance({
      chain,
      network,
      wallet: req.wallet!,
      args: req.query
    });
    return res.send(result || { confirmed: 0, unconfirmed: 0, balance: 0 });
  } catch (err: any) {
    logger.error('Error getting wallet balance: %o', err.stack || err.message || err);
    return res.status(500).json(err);
  }
});

router.get('/:pubKey/balance/:time', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  let { chain, network, time } = req.params;
  try {
    const result = await ChainStateProvider.getWalletBalanceAtTime({
      chain,
      network,
      wallet: req.wallet!,
      time,
      args: req.query
    });
    return res.send(result || { confirmed: 0, unconfirmed: 0, balance: 0 });
  } catch (err: any) {
    logger.error('Error getting wallet: %o', err.stack || err.message || err);
    return res.status(500).json(err);
  }
});

router.get('/:pubKey/utxos', Auth.authenticateMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  let { chain, network } = req.params;
  let { limit } = req.query as any;
  try {
    return ChainStateProvider.streamWalletUtxos({
      chain,
      network,
      wallet: req.wallet!,
      limit,
      req,
      res,
      args: req.query
    });
  } catch (err: any) {
    logger.error('Error streaming wallet utxos: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

router.get('/:pubKey', Auth.authenticateMiddleware, async function(req: AuthenticatedRequest, res: Response) {
  try {
    let wallet = req.wallet;
    return res.send(wallet);
  } catch (err: any) {
    logger.error('Error getting wallet: %o', err.stack || err.message || err);
    return res.status(500).send(err.message || err);
  }
});

module.exports = {
  router,
  path: '/wallet'
};
