/**
 * Thin wrapper around neo4j-driver for session/transaction management.
 */

import neo4j, { type Driver, type Session, type ManagedTransaction } from "neo4j-driver";

export interface Neo4jClientConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

export class Neo4jClient {
  private driver: Driver;
  private database: string;

  constructor(config: Neo4jClientConfig) {
    this.driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password));
    this.database = config.database ?? "neo4j";
  }

  /** Get a new session */
  session(): Session {
    return this.driver.session({ database: this.database });
  }

  /** Execute a read transaction */
  async read<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.session();
    try {
      return await session.executeRead(work);
    } finally {
      await session.close();
    }
  }

  /** Execute a write transaction */
  async write<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.session();
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  /** Run a single query (auto-commit) */
  async run(cypher: string, params?: Record<string, unknown>) {
    const session = this.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  /** Verify connectivity */
  async verify(): Promise<void> {
    await this.driver.verifyConnectivity();
  }

  /** Close the driver */
  async close(): Promise<void> {
    await this.driver.close();
  }
}
