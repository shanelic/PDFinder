// Reproducible local mail fixture only. No sender, recipient or secret inputs.
// These literals are PUBLIC synthetic data, never production credentials.
import {fixedFixtures} from './fixed-fixtures.mjs';
export const PUBLIC_SYNTHETIC_PASSWORD='SYNTHETIC-ONLY-DO-NOT-USE';
export const PUBLIC_SYNTHETIC_PROFILE='synthetic-fixture';
const PDF_SHA='88bcd7d2be5ff65e024d6b3a5964da2a0d10b1f36cbb2616abfc60556a8fe47c';
const PDF_BYTES=1825;
const FROM='synthetic-sender@example.invalid',TO='synthetic-recipient@example.invalid';
const BOUNDARY='pdfinder-synthetic-aes256-v1';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export async function createSyntheticMailFixture(...args) {
  if(args.length)throw new TypeError('Only the fixed synthetic fixture is supported');
  const fixture=fixedFixtures.find(f=>f.fixture_id==='AES-256.pdf');
  if(!fixture || fixture.sha256!==PDF_SHA || fixture.bytes!==PDF_BYTES || fixture.encrypted!==true)throw new Error('Synthetic fixture pin mismatch');
  const pdf=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));
  if(pdf.length!==PDF_BYTES || await digest(pdf)!==PDF_SHA)throw new Error('Synthetic fixture integrity mismatch');
  const lines=[
    `From: ${FROM}`,`To: ${TO}`,'Date: Thu, 01 Jan 1970 00:00:00 +0000',
    'Message-ID: <pdfinder-synthetic-aes256-v1@example.invalid>',
    'Subject: PDFinder public synthetic AES-256 fixture - NOT SENT',
    'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,'',
    `--${BOUNDARY}`,'Content-Type: text/plain; charset=us-ascii','Content-Transfer-Encoding: 7bit','',
    'Public synthetic data only. This locally prepared fixture has not been sent.',
    'The public fake password and source pins are recorded in manifest.json.',
    `--${BOUNDARY}`,'Content-Type: application/pdf; name="AES-256.pdf"',
    'Content-Disposition: attachment; filename="AES-256.pdf"','Content-Transfer-Encoding: base64','',
    ...fixture.data.match(/.{1,76}/g),`--${BOUNDARY}--`,''
  ];
  const emlBytes=new TextEncoder().encode(lines.join('\r\n'));
  return {emlBytes,manifest:{
    schema:'pdfinder_synthetic_mail_fixture_v1',scope:'public_synthetic_only',
    delivery:{status:'not_sent',from:FROM,to:TO,rfc_message_id:'<pdfinder-synthetic-aes256-v1@example.invalid>'},
    pdf:{filename:'AES-256.pdf',bytes:pdf.length,sha256:PDF_SHA,encryption:'AES-256',source:'src/fixed-fixtures.mjs'},
    eml:{filename:'synthetic-aes256.eml',bytes:emlBytes.length,sha256:await digest(emlBytes)},
    password:{classification:'public_synthetic_value_not_a_secret',profile:PUBLIC_SYNTHETIC_PROFILE,value:PUBLIC_SYNTHETIC_PASSWORD},
    limits:['No email sent or draft created','Not the historical 2476-byte mail fixture','A future send needs separate authorization','RFC Message-ID is not a Gmail/iCloud provider message ID']
  }};
}
