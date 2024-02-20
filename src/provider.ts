import {hexConcat} from '@ethersproject/bytes';
import {serialize, UnsignedTransaction} from '@ethersproject/transactions';
import {
  calcTypedDataSignatureV,
  compressPublicKey,
  hexStringToByteArray,
  joinSignature,
  prepareHashedEip712Data,
  stringToUtf8Bytes,
  BytesLike,
  Provider as ProviderBase,
  ProviderBaseOptions,
  ProviderInterface,
  TransactionRequest,
  TypedData,
} from '@haqq/provider-base';
import {
  accountInfo,
  derive,
  seedFromEntropy,
  sign,
} from '@haqq/provider-web3-utils';
import {generateEntropy} from '@haqq/provider-web3-utils/src/native-modules';
import {encryptShare, Share} from '@haqq/shared-react-native';
import {entropyToMnemonic, mnemonicToEntropy, mnemonicToSeed} from 'bip39';
import EncryptedStorage from 'react-native-encrypted-storage';
import {ITEM_KEY} from './constants';
import {getMnemonic} from './get-mnemonic';
import {ProviderMnemonicOptions} from './types';

export class ProviderMnemonicReactNative
  extends ProviderBase<ProviderMnemonicOptions>
  implements ProviderInterface
{
  static async initialize(
    mnemonic: string | null,
    getPassword: () => Promise<string>,
    options: Omit<ProviderBaseOptions, 'getPassword'>,
  ): Promise<ProviderMnemonicReactNative> {
    const password = await getPassword();

    const entropy =
      mnemonic === null
        ? (await generateEntropy(16)).toString('hex')
        : mnemonicToEntropy(mnemonic);
    const seed = await mnemonicToSeed(entropyToMnemonic(entropy));

    const privateData = await encryptShare(
      {
        share: entropy.padStart(64, '0'),
        shareIndex: entropy.length.toString(),
        polynomialID: '0',
      },
      password,
    );

    const rootPrivateKey = await derive(seed.toString('hex'), 'm');
    const {address} = await accountInfo(rootPrivateKey);

    await EncryptedStorage.setItem(
      `${ITEM_KEY}_${address.toLowerCase()}`,
      JSON.stringify(privateData),
    );

    const accounts = await ProviderMnemonicReactNative.getAccounts();

    await EncryptedStorage.setItem(
      `${ITEM_KEY}_accounts`,
      JSON.stringify(accounts.concat(address.toLowerCase())),
    );

    return new ProviderMnemonicReactNative({
      ...options,
      getPassword,
      account: address.toLowerCase(),
    });
  }

  static async getAccounts() {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_accounts`);

    return JSON.parse(storedKeys ?? '[]') as string[];
  }

  static async shareToSeed(share: Share) {
    const entropyLength = parseInt(share.shareIndex, 10);
    const entropy = share.share
      .slice(-1 * entropyLength)
      .padStart(entropyLength, '0');

    return seedFromEntropy(Buffer.from(entropy, 'hex'));
  }

  async updatePin(pin: string) {
    try {
      const decryptedData = await getMnemonic(
        this._options.account,
        this._options.getPassword,
      );
      const privateData = await encryptShare(decryptedData, pin);

      await EncryptedStorage.setItem(
        `${ITEM_KEY}_${this.getIdentifier().toLowerCase()}`,
        JSON.stringify(privateData),
      );
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'updatePin');
      }
    }
  }

  async clean() {
    try {
      await EncryptedStorage.removeItem(
        `${ITEM_KEY}_${this.getIdentifier().toLowerCase()}`,
      );
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'clean');
      }
    }
  }

  getIdentifier() {
    return this._options.account;
  }

  async getAccountInfo(hdPath: string) {
    let resp = {publicKey: '', address: ''};
    try {
      const share = await getMnemonic(
        this._options.account,
        this._options.getPassword,
      );

      if (!share) {
        throw new Error('seed_not_found');
      }

      const seed = await ProviderMnemonicReactNative.shareToSeed(share);

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const account = await accountInfo(privateKey);

      resp = {
        publicKey: compressPublicKey(account.publicKey),
        address: account.address,
      };
      this.emit('getPublicKeyForHDPath', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'getPublicKeyForHDPath');
      }
    }
    return resp;
  }

  async signTransaction(
    hdPath: string,
    transaction: TransactionRequest,
  ): Promise<string> {
    let resp = '';
    try {
      const share = await getMnemonic(
        this._options.account,
        this._options.getPassword,
      );

      if (!share) {
        throw new Error('seed_not_found');
      }

      const seed = await ProviderMnemonicReactNative.shareToSeed(share);

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
        this.catchError(e, 'signTransaction');
      }
    }

    return resp;
  }

  async signPersonalMessage(
    hdPath: string,
    message: BytesLike | string,
  ): Promise<string> {
    let resp = '';
    try {
      const share = await getMnemonic(
        this._options.account,
        this._options.getPassword,
      );

      if (!share) {
        throw new Error('seed_not_found');
      }

      const seed = await ProviderMnemonicReactNative.shareToSeed(share);

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const m = Array.from(
        typeof message === 'string' ? stringToUtf8Bytes(message) : message,
      );

      const hash = Buffer.from(
        [
          25, 69, 116, 104, 101, 114, 101, 117, 109, 32, 83, 105, 103, 110, 101,
          100, 32, 77, 101, 115, 115, 97, 103, 101, 58, 10,
        ].concat(stringToUtf8Bytes(String(message.length)), m),
      ).toString('hex');
      const signature = await sign(privateKey, hash);
      resp = '0x' + joinSignature(signature);
      this.emit('signTransaction', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'signTransaction');
      }
    }

    return resp;
  }

  async signTypedData(hdPath: string, typedData: TypedData): Promise<string> {
    let response = '';
    try {
      const share = await getMnemonic(
        this._options.account,
        this._options.getPassword,
      );

      if (!share) {
        throw new Error('seed_not_found');
      }

      const seed = await ProviderMnemonicReactNative.shareToSeed(share);

      const privateKey = await derive(seed, hdPath);

      if (!privateKey) {
        throw new Error('private_key_not_found');
      }

      const {domainSeparatorHex, hashStructMessageHex} =
        prepareHashedEip712Data(typedData);
      const concatHash = hexConcat([
        '0x1901',
        domainSeparatorHex,
        hashStructMessageHex,
      ]);
      response = await sign(privateKey, concatHash);
      this.emit('signTypedData', true);
    } catch (e) {
      if (e instanceof Error) {
        this.catchError(e, 'signTypedData');
      }
    }

    return calcTypedDataSignatureV(response);
  }

  /**
   * Check is mnemonic saved
   */
  async isMnemonicSaved(): Promise<boolean> {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_saved`);
    const accounts = JSON.parse(storedKeys ?? '[]') as string[];
    return accounts.includes(this.getIdentifier().toLowerCase());
  }

  /**
   * Set mnemonic saved
   */
  async setMnemonicSaved() {
    const storedKeys = await EncryptedStorage.getItem(`${ITEM_KEY}_saved`);
    const accounts = JSON.parse(storedKeys ?? '[]') as string[];
    await EncryptedStorage.setItem(
      `${ITEM_KEY}_saved`,
      JSON.stringify(accounts.concat(this.getIdentifier().toLowerCase())),
    );
  }

  /**
   * Get mnemonic phrase
   * @returns mnemonic
   */
  async getMnemonicPhrase(): Promise<string> {
    const share = await getMnemonic(
      this._options.account,
      this._options.getPassword,
    );

    const entropyLength = parseInt(share.shareIndex, 10);
    const entropy = share.share
      .slice(-1 * entropyLength)
      .padStart(entropyLength, '0');

    return entropyToMnemonic(entropy);
  }
}
