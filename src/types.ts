export type ProviderMnemonicOptions = {
  account: string;
  getPassword: () => Promise<string>;
};
