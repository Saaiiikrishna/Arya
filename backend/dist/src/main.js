"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const configService = app.get(config_1.ConfigService);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    const frontendUrl = configService.get('FRONTEND_URL', 'http://localhost:3000');
    const allowedOrigins = [
        frontendUrl,
        'http://localhost:3005',
        'https://aryavartham.com',
        'https://www.aryavartham.com'
    ];
    app.enableCors({
        origin: allowedOrigins,
        credentials: true,
    });
    const port = configService.get('PORT', 3001);
    await app.listen(port);
    console.log(`🚀 Arya Backend running on http://localhost:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map