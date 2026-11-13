// Stands in for `pg`: Seal runs the relay's object backend only, never the Postgres one.
export class Client {
  constructor() {
    throw new Error('seal-relay has no Postgres backend')
  }
}

export default { Client }
