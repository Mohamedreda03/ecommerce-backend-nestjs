import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const tracker = req.headers['x-forwarded-for'] || req.ip;
    
    if (typeof tracker === 'string') {
       return tracker.split(',')[0].trim();
    }
    
    // In case it's an array of strings
    if (Array.isArray(tracker) && tracker.length > 0) {
        return tracker[0].trim();
    }

    return req.ip;
  }
}
