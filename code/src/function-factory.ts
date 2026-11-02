import extraction from './functions/extraction';

export const functionFactory = { extraction } as const;

export type FunctionFactoryType = keyof typeof functionFactory;
