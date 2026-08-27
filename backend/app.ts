import express from 'express';
import cors from 'cors';
import { tmf620Router } from './api/tmf620/routes';
import { internalRouter } from './api/internal/routes';

export const app = express();

app.use(cors());
app.use(express.json());

// Mount the TMF620 adapter layer (External APIs)
app.use('/productCatalogManagement/v5', tmf620Router);

// Mount the Internal UI APIs
app.use('/api/internal', internalRouter);

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
