const express = require('express');
const { listRuns } = require('../lib/runs');

const router = express.Router();

router.get('/', (req, res) => res.json(listRuns(req.query.agent)));

module.exports = router;
