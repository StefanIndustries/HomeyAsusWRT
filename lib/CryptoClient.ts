import crypto from 'crypto';
import { CryptoData } from './models/CryptoData';

export class CryptoClient {
    constructor(private secretKey: string) {}

    private algorithm = 'aes-256-ctr';
    
    public encrypt = (text: string): CryptoData => {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
        const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
        return {
            iv: iv.toString('hex'),
            content: encrypted.toString('hex')
        };
    };
    
    public decrypt = (cryptoData: CryptoData): string => {
        const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, Buffer.from(cryptoData.iv, 'hex'));
        const decrypted = Buffer.concat([decipher.update(Buffer.from(cryptoData.content, 'hex')), decipher.final()]);
        return decrypted.toString();
    };
}