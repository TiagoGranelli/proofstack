// The certificate of the edge with `tls` (scripts/edge.ts): Caddy's internal CA, which this process then trusts
// for its own requests, and the SPKI hash of the served key, which a browser can trust alone.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, getCACertificates, setDefaultCACertificates } from 'node:tls'

/** Caddy's internal root certificate, relative to its data directory. */
const ROOT_CERTIFICATE = 'caddy/pki/authorities/local/root.crt'

/**
 * Caddy's internal root certificate (PEM), from the binary's `dataHome` or else from the container. Throws until
 * Caddy has created it.
 */
export const readRootCertificate = (container: string, dataHome: string | undefined): string => {
  if (dataHome) {
    const path = join(dataHome, 'data', ROOT_CERTIFICATE)
    if (!existsSync(path)) throw new Error(`no root certificate at ${path} yet`)
    return readFileSync(path, 'utf8')
  }
  const cat = spawnSync('docker', ['exec', container, 'cat', `/data/${ROOT_CERTIFICATE}`], { encoding: 'utf8' })
  if (cat.status !== 0 || !cat.stdout.includes('BEGIN CERTIFICATE'))
    throw new Error(`no PEM root certificate at ${container}:/data/${ROOT_CERTIFICATE} yet (exit ${cat.status})`)
  return cat.stdout
}

/** Adds the edge's CA to the ones this process trusts (fetch included), keeping the system's. */
export const trustCertificateAuthority = (pem: string): void => {
  const current = getCACertificates('default')
  if (!current.includes(pem)) setDefaultCACertificates([...current, pem])
}

/** Base64 SHA-256 of the DER public key of the certificate the edge serves for localhost. */
export const servedCertificateSpki = (port: string): Promise<string> =>
  new Promise<string>((resolveSpki, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port), servername: 'localhost' }, () => {
      const certificate = socket.getPeerX509Certificate()
      socket.end()
      if (!certificate) {
        reject(new Error(`the edge at 127.0.0.1:${port} sent no certificate for localhost`))
        return
      }
      resolveSpki(
        createHash('sha256')
          .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
          .digest('base64'),
      )
    }).once('error', reject)
  })
