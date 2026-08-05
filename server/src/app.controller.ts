import { Controller, Get } from '@nestjs/common';
import { AppService, type HealthStatus } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Liveness check — always 200 as long as the process is up. No dependency checks (DB, etc.) yet. */
  @Get('health')
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
