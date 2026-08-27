import express from 'express';
import { tmf620Router } from './api/tmf620/routes';

export const app = express();

app.use(express.json());

// Mount the TMF620 adapter layer
app.use('/productCatalogManagement/v5', tmf620Router);

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
