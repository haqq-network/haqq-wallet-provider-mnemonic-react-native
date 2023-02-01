import {hexConcat} from '@ethersproject/bytes';
import {serialize, UnsignedTransaction} from '@ethersproject/transactions';
import {encrypt} from '@haqq/encryption-react-native';
import {
  BytesLike,
  compressPublicKey,
  hexStringToByteArray,
  joinSignature,
  Provider as ProviderBase,
  ProviderBaseOptions,
  ProviderInterface,
  stringToUtf8Bytes,
  TransactionRequest
} from '@haqq/provider-base';
import {
  accountInfo,
  derive,
  generateMnemonic,
  seedFromMnemonic,
  sign
} from '@haqq/provider-web3-utils'
import EncryptedStorage from 'react-native-encrypted-storage';
import {ITEM_KEY} from './constants';
import {getMnemonic} from './get-mnemonic';
import {ProviderMnemonicOptions} from './types';

export class ProviderMnemonicReactNative extends ProviderBase<ProviderMnemonicOptions> implements ProviderInterface {
  static async initialize(mnemonic: string | null, getPassword: () => Promise<string>, options: Omit<ProviderBaseOptions, 'getPassword'>): Promise<ProviderMnemonicReactNative> {
    const password = await getPassword();

    const m = mnemonic === null ? await generateMnemonic() : mnemonic;

    const seed = await seedFromMnemonic(m);

    const privateData = await encrypt(password, {
      mnemonic: m,
      seed
    });

    const rootPrivateKey = await derive(seed, 'm');
    const {address} = await accountInfo(rootPrivateKey);

    await EncryptedStorage.setItem(
      `${ITEM_KEY}_${address.toLowerCase()}`,
      privateData
    );

    const accounts = await ProviderMnemonicReactNative.getAccounts();

    await EncryptedStorage.setItem(`${ITEM_KEY}_accounts`, JSON.stringify(accounts.concat(address.toLowerCase())));

    return new ProviderMnemonicReactNative({
      ...options,
      getPassword,
      account: address.toLowerCase()
    })
  }

  static async getAccounts() {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_accounts`);

    return JSON.parse(storedKeys ?? '[]') as string[]
  }

  async updatePin(pin: string) {
    try {
      const decryptedData = await getMnemonic(this._options.account, this._options.getPassword)
      const privateData = await encrypt(pin, decryptedData);

      await EncryptedStorage.setItem(
        `${ITEM_KEY}_${this.getIdentifier().toLowerCase()}`,
        privateData
      );
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'updatePin')
      }
    }
  }

  async clean() {
    try {
      await EncryptedStorage.removeItem(
        `${ITEM_KEY}_${this.getIdentifier().toLowerCase()}`
      );
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'clean')
      }
    }
  }

  getIdentifier() {
    return this._options.account
  }

  async getAccountInfo(hdPath: string) {
    let resp = {publicKey: '', address: ''}
    try {
      const {seed} = await getMnemonic(this._options.account, this._options.getPassword)

      if (!seed) {
        throw new Error('seed_not_found');
      }

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const account = await accountInfo(privateKey);

      resp = {
        publicKey: compressPublicKey(account.publicKey),
        address: account.address
      }
      this.emit('getPublicKeyForHDPath', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'getPublicKeyForHDPath')
      }
    }
    return resp
  }

  async signTransaction(hdPath: string, transaction: TransactionRequest): Promise<string> {
    let resp = ''
    try {
      const {seed} = await getMnemonic(this._options.account, this._options.getPassword)

      if (!seed) {
        throw new Error('seed_not_found');
      }

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const signature = await sign(
        privateKey,
        serialize(transaction as UnsignedTransaction),
      );

      const sig = hexStringToByteArray(signature);

      resp = serialize(transaction as UnsignedTransaction, sig);

      this.emit('signTransaction', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'signTransaction')
      }
    }

    return resp
  }

  async signPersonalMessage(hdPath: string, message: BytesLike | string): Promise<string> {
    let resp = ''
    try {
      const {seed} = await getMnemonic(this._options.account, this._options.getPassword)

      if (!seed) {
        throw new Error('seed_not_found');
      }

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const m = Array.from(typeof message === 'string' ? stringToUtf8Bytes(message) : message);

      const hash = Buffer.from([25, 69, 116, 104, 101, 114, 101, 117, 109, 32, 83, 105, 103, 110, 101, 100, 32, 77, 101, 115, 115, 97, 103, 101, 58, 10].concat(
        stringToUtf8Bytes(String(message.length)), m
      )).toString('hex');
      const signature = await sign(privateKey, hash,);
      resp = '0x' + joinSignature(signature);
      this.emit('signTransaction', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'signTransaction')
      }
    }

    return resp
  }

  async signTypedData(hdPath: string, domainHash: string, valueHash: string): Promise<string> {
    let response = ''
    try {
      const {seed} = await getMnemonic(this._options.account, this._options.getPassword)

      if (!seed) {
        throw new Error('seed_not_found');
      }

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const concatHash = hexConcat(['0x1901', domainHash, valueHash]);
      response = await sign(privateKey, concatHash);
      this.emit('signTypedData', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'signTypedData')
      }
    }

    return response
  }

  async isMnemonicSaved() {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_saved`);
    const accounts = JSON.parse(storedKeys ?? '[]') as string[]
    return accounts.includes(this.getIdentifier().toLowerCase())
  }

  async setMnemonicSaved() {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_saved`);
    const accounts = JSON.parse(storedKeys ?? '[]') as string[]
    await EncryptedStorage.setItem(`${ITEM_KEY}_saved`, JSON.stringify(accounts.concat(this.getIdentifier().toLowerCase())));
  }
}
