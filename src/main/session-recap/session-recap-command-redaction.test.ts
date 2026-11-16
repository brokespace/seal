import { describe, expect, it } from 'vitest'
import { redactRecapCommand } from './session-recap-command-redaction'

describe('redactRecapCommand', () => {
  it.each([
    ['psql postgres://admin:s3cret@db/app', 'psql postgres://admin:[redacted]@db/app'],
    [
      'git clone https://user:token@github.com/org/repo.git',
      'git clone https://user:[redacted]@github.com/org/repo.git'
    ],
    [
      'DATABASE_URL=postgres://app:s3cret@db:5432/app pnpm db:migrate',
      'DATABASE_URL=postgres://app:[redacted]@db:5432/app pnpm db:migrate'
    ],
    ['docker login --password hunter2', 'docker login --password [redacted]'],
    [
      'tool --password=hunter2 --token a1 --api-key=b2 --secret c3 --access-token d4 --auth-token e5 --client-secret f6 --passphrase g7',
      'tool --password=[redacted] --token [redacted] --api-key=[redacted] --secret [redacted] --access-token [redacted] --auth-token [redacted] --client-secret [redacted] --passphrase [redacted]'
    ],
    ['mysql -u root -phunter2 app', 'mysql -u root -p[redacted] app'],
    ['mysqldump -uroot -phunter2 app > dump.sql', 'mysqldump -uroot -p[redacted] app > dump.sql'],
    ['docker login -u bob -p hunter2 registry.io', 'docker login -u bob -p [redacted] registry.io'],
    [
      'curl -u bob:hunter2 https://api.example.com',
      'curl -u bob:[redacted] https://api.example.com'
    ],
    [
      'curl --user "bob:hunter2" https://api.example.com',
      'curl --user "bob:[redacted]" https://api.example.com'
    ],
    [
      "curl -H 'Authorization: Bearer abc' https://api.example.com",
      "curl -H 'Authorization: Bearer [redacted]' https://api.example.com"
    ],
    [
      'curl -sH "X-Api-Key: abc" https://api.example.com',
      'curl -sH "X-Api-Key: [redacted]" https://api.example.com'
    ],
    [
      'curl --header "Authorization: Basic dXNlcjpwYXNz" https://api.example.com',
      'curl --header "Authorization: Basic [redacted]" https://api.example.com'
    ],
    [
      'API_KEY=abc123 NODE_ENV=production pnpm test',
      'API_KEY=[redacted] NODE_ENV=production pnpm test'
    ],
    ['export GITHUB_TOKEN=abc123', 'export GITHUB_TOKEN=[redacted]'],
    ['env DB_PASS=hunter2 node migrate.js', 'env DB_PASS=[redacted] node migrate.js'],
    [
      'docker run -e API_TOKEN=abc -e NODE_ENV=production img',
      'docker run -e API_TOKEN=[redacted] -e NODE_ENV=production img'
    ],
    [
      'docker build --build-arg NPM_TOKEN=abc123 .',
      'docker build --build-arg NPM_TOKEN=[redacted] .'
    ],
    [
      'PGPASSWORD=hunter2 AWS_ACCESS_KEY=a1 PRIVATE_KEY=b2 CLIENT_SECRET=c3 CREDENTIALS=d4 NPM_AUTH=e5 COOKIE=f6 SESSION_ID=g7 SENTRY_DSN=h8 PASSWD=i9 run',
      'PGPASSWORD=[redacted] AWS_ACCESS_KEY=[redacted] PRIVATE_KEY=[redacted] CLIENT_SECRET=[redacted] CREDENTIALS=[redacted] NPM_AUTH=[redacted] COOKIE=[redacted] SESSION_ID=[redacted] SENTRY_DSN=[redacted] PASSWD=[redacted] run'
    ],
    [
      'aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'aws configure set aws_secret_access_key [redacted]'
    ],
    [
      'aws configure set aws_session_token abcdef',
      'aws configure set aws_session_token [redacted]'
    ],
    [
      'npm config set //registry.npmjs.org/:_authToken abc123',
      'npm config set //registry.npmjs.org/:_authToken [redacted]'
    ],
    ['git config --global user.password hunter2', 'git config --global user.password [redacted]'],
    [
      `curl -d '{"password": "hunter2", "user": "bob"}' https://api.example.com`,
      `curl -d '{"password": "[redacted]", "user": "bob"}' https://api.example.com`
    ],
    [
      'curl "https://api.example.com/v1?api_key=abc123&page=2"',
      'curl "https://api.example.com/v1?api_key=[redacted]&page=2"'
    ],
    [
      `bash -c "mysql -uroot -phunter2 -e 'select 1'"`,
      `bash -c "mysql -uroot -p[redacted] -e 'select 1'"`
    ],
    [
      `psql -c "ALTER USER app WITH PASSWORD 'hunter2'"`,
      `psql -c "ALTER USER app WITH PASSWORD '[redacted]'"`
    ],
    ['set API_KEY=abc123 && npm test', 'set API_KEY=[redacted] && npm test'],
    ['$env:GITHUB_TOKEN="abc123"; npm test', '$env:GITHUB_TOKEN="[redacted]"; npm test'],
    [
      String.raw`"C:\Program Files\MySQL\bin\mysql.exe" -uroot -phunter2`,
      String.raw`"C:\Program Files\MySQL\bin\mysql.exe" -uroot -p[redacted]`
    ],
    [
      'echo ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA | gh auth login --with-token',
      'echo [redacted:github-token] | gh auth login --with-token'
    ],
    [
      'cat > .env <<EOF\nPORT=3000\nAPI_KEY=abc123\nEOF',
      'cat > .env <<EOF\nPORT=3000\nAPI_KEY=[redacted]\nEOF'
    ]
  ])('replaces the credential in %s', (command, redacted) => {
    expect(redactRecapCommand(command)).toBe(redacted)
  })

  it.each([
    'rg -l moment packages | wc -l',
    'pnpm test',
    'pnpm test src/parser.test.ts --maxWorkers=2',
    'git commit -m "add healthz"',
    'npm run build && npm test',
    'sed -n 1,40p src/a.ts',
    'curl -s http://localhost:3000/healthz',
    'docker run -p 8080:80 nginx',
    'ssh -p 2222 build-box uptime',
    'git log --oneline -5',
    'grep -rn "password" src/',
    'ls -la',
    'RECAP_SCENARIOS_LIVE=1 pnpm test',
    'NODE_ENV=production CI=true PORT=3000 ORCA_BACKGROUND_LAUNCH=1 pnpm dev',
    'KEYBOARD=us MONKEY=1 MAX_TOKENS=4096 GIT_AUTHOR_NAME=bob TOKEN_TTL=3600 run',
    'A=1\nB=2 pnpm test',
    'mysql -u root -p app',
    'psql -p 5432 -h db',
    'curl -u bob https://api.example.com',
    'docker run -u 1000:1000 nginx',
    'docker login --password-stdin registry.io',
    'curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user',
    'PGPASSWORD="$DB_PASS" psql -h db',
    'export GH_TOKEN=$(gh auth token)',
    'if [ "$TOKEN" = "" ]; then echo missing; fi',
    'git config --global credential.helper store',
    'aws configure set region us-east-1',
    'rg "password: " src',
    'pnpm run auth:login',
    'docker run -v secret:/run/secret img',
    'git commit -m "token: add refresh"',
    'git commit -m "feat: support bearer token auth"',
    'git commit -m "add --token flag"',
    String.raw`type C:\Users\me\project\token.txt`
  ])('returns %s as it was written', (command) => {
    expect(redactRecapCommand(command)).toBe(command)
  })
})
