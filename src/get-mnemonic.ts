import {decrypt} from '@haqq/encryption-react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import {ITEM_KEY} from './constants';

export async function getMnemonic(id: string, getPassword: () => Promise<string>) {
  const password = await getPassword();
  const data = await EncryptedStorage.getItem(`${ITEM_KEY}_${id}`);

  if(!data) {
    throw new Error('encrypted_data_not_found')
  }

  const resp = await decrypt<{mnemonic: string, seed: string}>(password, data);

  if (!resp.mnemonic) {
    throw new Error('mnemonic_not_found');
  }

  return resp
}
