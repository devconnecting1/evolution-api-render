export interface ICache {
  get(key: string): Promise<any>;

  hGet(key: string, field: string): Promise<any>;

  /** Every field of a hash, each decoded like `hGet` does; null when the hash does not exist or cannot be read. */
  hGetAll(key: string): Promise<Record<string, any> | null>;

  set(key: string, value: any, ttl?: number): void;

  hSet(key: string, field: string, value: any): Promise<void>;

  has(key: string): Promise<boolean>;

  keys(appendCriteria?: string): Promise<string[]>;

  delete(key: string | string[]): Promise<number>;

  hDelete(key: string, field: string): Promise<any>;

  deleteAll(appendCriteria?: string): Promise<number>;
}
