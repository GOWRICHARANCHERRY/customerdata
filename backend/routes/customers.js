const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken, adminOnly, requirePermission } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const ALLOWED_SEARCH_TYPES = ['customerName', 'phoneNumber', 'itemType', 'billNo', 'itemName', 'status'];
const ALLOWED_ITEM_TYPES = ['Gold', 'Silver'];
const MAX_LENGTHS = {
  customerName: 100, address: 500, itemName: 200,
  phoneNumber: 20, billNo: 50, notes: 2000, purity: 50
};

async function addAuditLog(queryFn, action, recordId, recordData, details = {}, user) {
  const logEntry = {
    id: uuidv4(),
    user: user.username,
    userRole: user.role || 'user',
    action,
    recordId,
    recordData: recordData || {},
    details,
    billNumber: recordData ? recordData.billNo : null,
    customerName: recordData ? recordData.customerName : null
  };

  await queryFn(
    `INSERT INTO audit_logs (id, timestamp, "user", "userRole", action, "recordId", "recordData", details, "billNumber", "customerName")
     VALUES ($1, NOW(), $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [logEntry.id, logEntry.user, logEntry.userRole, logEntry.action, logEntry.recordId,
     JSON.stringify(logEntry.recordData), JSON.stringify(logEntry.details), logEntry.billNumber, logEntry.customerName]
  );

  if (recordId) {
    await queryFn(
      `INSERT INTO record_histories (id, "recordId", timestamp, "user", "userRole", action, "recordData", details, "billNumber", "customerName")
       VALUES ($1, $2, NOW(), $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [logEntry.id, logEntry.recordId, logEntry.user, logEntry.userRole, logEntry.action,
       JSON.stringify(logEntry.recordData), JSON.stringify(logEntry.details), logEntry.billNumber, logEntry.customerName]
    );
  }
}

// ─── Static literal routes (MUST come before /:id) ───────────────

router.get('/', authenticateToken, async (req, res) => {
  try {
    let queryText = 'SELECT * FROM customer_records WHERE 1=1';
    const params = [];

    const { filterType, filterStatus, minAmount, maxAmount, pendingFilter, sortBy, searchType, searchValue } = req.query;

    if (filterType) {
      if (!ALLOWED_ITEM_TYPES.includes(filterType)) {
        return res.status(400).json({ error: 'Invalid filter type' });
      }
      queryText += ' AND "itemType" = $' + (params.length + 1);
      params.push(filterType);
    }
    if (filterStatus) {
      if (filterStatus === 'active') {
        queryText += " AND (status IS NULL OR status = 'active')";
      } else if (filterStatus === 'sold') {
        queryText += " AND status = 'sold'";
      } else {
        return res.status(400).json({ error: 'Invalid filter status' });
      }
    }
    if (minAmount) {
      queryText += ' AND "itemAmount" >= $' + (params.length + 1);
      params.push(parseFloat(minAmount));
    }
    if (maxAmount) {
      queryText += ' AND "itemAmount" <= $' + (params.length + 1);
      params.push(parseFloat(maxAmount));
    }
    if (pendingFilter === 'pending') {
      queryText += ' AND "pendingMoney" > 0';
    } else if (pendingFilter === 'no-pending') {
      queryText += ' AND ("pendingMoney" IS NULL OR "pendingMoney" = 0)';
    }

    if (searchValue) {
      if (searchType === 'billNo') {
        queryText += ' AND ("billNo" ILIKE $' + (params.length + 1) + ')';
        params.push(`%${searchValue}%`);
      } else if (searchType && ALLOWED_SEARCH_TYPES.includes(searchType)) {
        queryText += ' AND "' + searchType + '" ILIKE $' + (params.length + 1);
        params.push(`%${searchValue}%`);
      } else if (searchType) {
        return res.status(400).json({ error: 'Invalid search type' });
      }
    }

    switch (sortBy) {
      case 'oldest': queryText += ' ORDER BY "createdAt" ASC'; break;
      case 'amount-high': queryText += ' ORDER BY "itemAmount" DESC'; break;
      case 'amount-low': queryText += ' ORDER BY "itemAmount" ASC'; break;
      case 'name': queryText += ' ORDER BY "customerName" ASC'; break;
      case 'pending-high': queryText += ' ORDER BY "pendingMoney" DESC'; break;
      default: queryText += ' ORDER BY "createdAt" DESC';
    }

    const result = await db.query(queryText, params);
    const records = result.rows.map(r => ({
      ...r,
      extraMoney: r.extraMoney || [],
      moneyBack: r.moneyBack || []
    }));

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, requirePermission('dataEntryAccess'), async (req, res) => {
  try {
    const {
      billNo, billDate, customerName, phoneNumber, address,
      itemName, itemType, itemAmount, interest, weight, purity,
      notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack
    } = req.body;

    if (!billNo || !customerName || !address || !itemName || !itemType || itemAmount == null || interest == null || weight == null) {
      return res.status(400).json({ error: 'Please fill all required fields' });
    }

    if (!ALLOWED_ITEM_TYPES.includes(itemType)) {
      return res.status(400).json({ error: 'Item type must be Gold or Silver' });
    }

    if (customerName && customerName.length > MAX_LENGTHS.customerName) {
      return res.status(400).json({ error: 'Customer name too long (max 100)' });
    }
    if (billNo && billNo.length > MAX_LENGTHS.billNo) {
      return res.status(400).json({ error: 'Bill number too long (max 50)' });
    }

    const existing = await db.query('SELECT id FROM customer_records WHERE "billNo" = $1', [billNo]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bill number already exists' });
    }

    const id = uuidv4();
    const record = {
      id,
      billNo: billNo.trim(),
      billDate: billDate || '',
      customerName: customerName.trim(),
      phoneNumber: phoneNumber || '',
      address: address.trim(),
      itemName: itemName.trim(),
      itemType,
      itemAmount: parseFloat(itemAmount),
      interest: parseFloat(interest),
      weight: parseFloat(weight),
      purity: purity || '',
      notes: notes || '',
      pendingMoney: parseFloat(pendingMoney) || 0,
      extraMoneyCount: parseInt(extraMoneyCount) || 0,
      extraMoney: extraMoney || [],
      moneyBackCount: parseInt(moneyBackCount) || 0,
      moneyBack: moneyBack || [],
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: req.user.username
    };

    await db.query(
      `INSERT INTO customer_records (id, "billNo", "billDate", "customerName", "phoneNumber", address, "itemName", "itemType", "itemAmount", interest, weight, purity, notes, "pendingMoney", "extraMoneyCount", "extraMoney", "moneyBackCount", "moneyBack", status, "createdAt", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18::jsonb, $19, $20, $21)`,
      [record.id, record.billNo, record.billDate, record.customerName, record.phoneNumber,
       record.address, record.itemName, record.itemType, record.itemAmount, record.interest,
       record.weight, record.purity, record.notes, record.pendingMoney, record.extraMoneyCount,
       JSON.stringify(record.extraMoney), record.moneyBackCount, JSON.stringify(record.moneyBack),
       record.status, record.createdAt, record.createdBy]
    );

    const createdResult = await db.query('SELECT * FROM customer_records WHERE id = $1', [id]);
    const createdRecord = createdResult.rows[0];
    createdRecord.extraMoney = createdRecord.extraMoney || [];
    createdRecord.moneyBack = createdRecord.moneyBack || [];

    await addAuditLog(db.query, 'CREATE', id, createdRecord, {
      message: `New customer record created: ${customerName}`,
      itemType, amount: itemAmount
    }, req.user);

    res.json(createdRecord);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/next-bill-no', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT "billNo" FROM customer_records ORDER BY CAST(REGEXP_REPLACE("billNo", '\\D', '', 'g') AS INTEGER) DESC LIMIT 1`);
    let next = 1;
    if (result.rows.length > 0) {
      const num = parseInt(result.rows[0].billNo.replace(/\D/g, ''));
      next = (num || 0) + 1;
    }
    res.json({ nextBillNo: next });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/bulk-delete', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No record IDs provided' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        const recResult = await client.query('SELECT * FROM customer_records WHERE id = $1', [id]);
        const record = recResult.rows[0];
        if (record) {
          await addAuditLog(client.query, 'DELETE', id, record, {
            message: `Bulk delete: ${record.customerName}`, billNumber: record.billNo
          }, req.user);
          await client.query('DELETE FROM customer_records WHERE id = $1', [id]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ message: `${ids.length} record(s) deleted` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bulk-mark-sold', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No record IDs provided' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        const recResult = await client.query('SELECT * FROM customer_records WHERE id = $1', [id]);
        const record = recResult.rows[0];
        if (record) {
          await addAuditLog(client.query, 'MARK_SOLD', id, record, {
            message: `Bulk mark sold: ${record.customerName}`,
            previousStatus: record.status || 'active'
          }, req.user);
          await client.query("UPDATE customer_records SET status = 'sold', \"soldAt\" = NOW(), \"updatedAt\" = NOW() WHERE id = $1", [id]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ message: `${ids.length} record(s) marked as sold` });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/import-excel', authenticateToken, requirePermission('excelAccess'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!jsonData.length) return res.status(400).json({ error: 'Empty file' });

    const imported = [];
    const errors = [];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < jsonData.length; index++) {
        const row = jsonData[index];
        try {
          const billNo = (row['Bill Number'] || '').toString().trim();
          if (!billNo) { errors.push(`Row ${index + 2}: Missing Bill Number`); continue; }

          const existing = await client.query('SELECT id FROM customer_records WHERE "billNo" = $1', [billNo]);
          if (existing.rows.length > 0) { errors.push(`Row ${index + 2}: Bill ${billNo} already exists`); continue; }

          const itemType = (row['Item Type'] || '').toString().trim();
          if (itemType !== 'Gold' && itemType !== 'Silver') { errors.push(`Row ${index + 2}: Item type must be Gold/Silver`); continue; }

          const id = uuidv4();
          await client.query(
            `INSERT INTO customer_records (id, "billNo", "billDate", "customerName", "phoneNumber", address, "itemName", "itemType", "itemAmount", interest, weight, purity, notes, "pendingMoney", "extraMoneyCount", "extraMoney", "moneyBackCount", "moneyBack", status, "createdAt", "createdBy")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18::jsonb, $19, $20, $21)`,
            [id, billNo, row['Bill Date'] || '', (row['Customer Name'] || '').toString().trim(),
             (row['Phone Number'] || '').toString().trim(), (row['Address'] || '').toString().trim(),
             (row['Item Name'] || '').toString().trim(), itemType,
             parseFloat(row['Item Amount']) || 0, parseFloat(row['Interest (%)']) || 0,
             parseFloat(row['Weight (grams)']) || 0, (row['Purity'] || '').toString().trim(),
             (row['Notes'] || '').toString().trim(), parseFloat(row['Pending Money']) || 0,
             parseInt(row['Extra Money Count']) || 0, '[]', parseInt(row['Money Back Count']) || 0, '[]',
             ((row['Status'] || 'active').toString().toLowerCase() === 'sold' ? 'sold' : 'active'),
             new Date().toISOString(), req.user.username]
          );
          imported.push(billNo);
        } catch (e) {
          errors.push(`Row ${index + 2}: Import error`);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({
      imported: imported.length,
      errors: errors.length,
      errorDetails: errors,
      message: `Imported ${imported.length} records. ${errors.length} errors.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export-excel', authenticateToken, requirePermission('excelAccess'), async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let dateFilter = '';
    const params = [];
    if (dateFrom) { dateFilter += ' AND "createdAt"::date >= $' + (params.length + 1) + '::date'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND "createdAt"::date <= $' + (params.length + 1) + '::date'; params.push(dateTo); }

    const recordsResult = await db.query(`SELECT * FROM customer_records WHERE 1=1 ${dateFilter} ORDER BY "createdAt" DESC`, params);
    const excelData = recordsResult.rows.map(r => ({
      'Bill Number': r.billNo,
      'Bill Date': r.billDate || '',
      'Customer Name': r.customerName,
      'Phone Number': r.phoneNumber || '',
      'Address': r.address,
      'Item Name': r.itemName,
      'Item Type': r.itemType,
      'Item Amount': r.itemAmount,
      'Interest (%)': r.interest,
      'Weight (grams)': r.weight,
      'Purity': r.purity || '',
      'Notes': r.notes || '',
      'Pending Money': r.pendingMoney || 0,
      'Extra Money Count': r.extraMoneyCount || 0,
      'Extra Money Details': JSON.stringify(r.extraMoney || []),
      'Money Back Count': r.moneyBackCount || 0,
      'Money Back Details': JSON.stringify(r.moneyBack || []),
      'Status': r.status || 'active',
      'Created At': r.createdAt || '',
      'Updated At': r.updatedAt || '',
      'Sold At': r.soldAt || '',
      'Created By': r.createdBy || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Customer Records');

    const historyResult = await db.query('SELECT * FROM record_histories ORDER BY timestamp DESC');
    const historyData = historyResult.rows.map(h => ({
      'Record ID': h.recordId || '',
      'Bill Number': h.billNumber || '',
      'Customer Name': h.customerName || '',
      'Action': h.action || '',
      'User': h.user || '',
      'User Role': h.userRole || '',
      'Timestamp': h.timestamp || '',
      'Details': JSON.stringify(h.details || {}),
      'Record Data (JSON)': JSON.stringify(h.recordData || {})
    }));
    const ws2 = XLSX.utils.json_to_sheet(historyData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Change History');

    const auditResult = await db.query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    const auditData = auditResult.rows.map(a => ({
      'Record ID': a.recordId || '',
      'Bill Number': a.billNumber || '',
      'Customer Name': a.customerName || '',
      'Action': a.action || '',
      'User': a.user || '',
      'User Role': a.userRole || '',
      'Timestamp': a.timestamp || '',
      'Details': JSON.stringify(a.details || {}),
      'Record Data (JSON)': JSON.stringify(a.recordData || {})
    }));
    const ws3 = XLSX.utils.json_to_sheet(auditData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Audit Logs');

    const dateStr = new Date().toISOString().split('T')[0];
    const rangeStr = dateFrom && dateTo ? `_${dateFrom}_to_${dateTo}` : '';
    const filename = `backup_${dateStr}${rangeStr}.xlsx`;
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/download-template', authenticateToken, requirePermission('excelAccess'), (req, res) => {
  try {
    const template = [{
      'Bill Number': 'BILL001',
      'Bill Date': '2024-01-01',
      'Customer Name': 'John Doe',
      'Phone Number': '1234567890',
      'Address': '123 Main Street, City',
      'Item Name': 'Gold Ring',
      'Item Type': 'Gold',
      'Item Amount': 50000,
      'Interest (%)': 2.5,
      'Weight (grams)': 10.5,
      'Purity': '22K',
      'Pending Money': 0,
      'Extra Money Count': 0,
      'Money Back Count': 0,
      'Notes': 'Sample record',
      'Status': 'active'
    }];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customer_records_template.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-logs/all', authenticateToken, adminOnly, async (req, res) => {
  try {
    let queryText = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    const { actionFilter, userFilter, dateFilter } = req.query;
    if (actionFilter) { queryText += ' AND action = $' + (params.length + 1); params.push(actionFilter); }
    if (userFilter) { queryText += ' AND "user" = $' + (params.length + 1); params.push(userFilter); }
    if (dateFilter) { queryText += ' AND timestamp::date = $' + (params.length + 1) + '::date'; params.push(dateFilter); }

    queryText += ' ORDER BY timestamp DESC';
    const result = await db.query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-logs/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    const result = await db.query('SELECT DISTINCT "user" FROM audit_logs ORDER BY "user"');
    res.json(result.rows.map(u => u.user));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/analytics/summary', authenticateToken, requirePermission('analyticsAccess'), async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let dateFilter = '';
    const params = [];
    if (dateFrom) { dateFilter += ' AND "createdAt"::date >= $' + (params.length + 1) + '::date'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND "createdAt"::date <= $' + (params.length + 1) + '::date'; params.push(dateTo); }

    const totalRecords = await db.query(`SELECT COUNT(*) as count FROM customer_records WHERE 1=1 ${dateFilter}`, params);
    const totalActive = await db.query(`SELECT COUNT(*) as count FROM customer_records WHERE (status IS NULL OR status = 'active') ${dateFilter}`, params);
    const totalSold = await db.query(`SELECT COUNT(*) as count FROM customer_records WHERE status = 'sold' ${dateFilter}`, params);
    const totalAmount = await db.query(`SELECT COALESCE(SUM("itemAmount"), 0) as total FROM customer_records WHERE 1=1 ${dateFilter}`, params);
    const totalPending = await db.query(`SELECT COALESCE(SUM("pendingMoney"), 0) as total FROM customer_records WHERE 1=1 ${dateFilter}`, params);
    const goldCount = await db.query(`SELECT COUNT(*) as count FROM customer_records WHERE "itemType" = 'Gold' ${dateFilter}`, params);
    const silverCount = await db.query(`SELECT COUNT(*) as count FROM customer_records WHERE "itemType" = 'Silver' ${dateFilter}`, params);

    res.json({
      totalRecords: parseInt(totalRecords.rows[0].count),
      totalActive: parseInt(totalActive.rows[0].count),
      totalSold: parseInt(totalSold.rows[0].count),
      totalAmount: parseFloat(totalAmount.rows[0].total),
      totalPending: parseFloat(totalPending.rows[0].total),
      goldCount: parseInt(goldCount.rows[0].count),
      silverCount: parseInt(silverCount.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/analytics/chart', authenticateToken, requirePermission('analyticsAccess'), async (req, res) => {
  try {
    const { dateFrom, dateTo, chartType } = req.query;
    let dateFilter = '';
    const params = [];
    if (dateFrom) { dateFilter += ' AND "createdAt"::date >= $' + (params.length + 1) + '::date'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND "createdAt"::date <= $' + (params.length + 1) + '::date'; params.push(dateTo); }

    if (chartType === 'sales') {
      const result = await db.query(`SELECT "createdAt"::date as label, COUNT(*) as count, COALESCE(SUM("itemAmount"), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY "createdAt"::date ORDER BY label`, params);
      return res.json(result.rows);
    }
    if (chartType === 'itemType') {
      const result = await db.query(`SELECT "itemType" as label, COUNT(*) as count, COALESCE(SUM("itemAmount"), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY "itemType"`, params);
      return res.json(result.rows);
    }
    if (chartType === 'status') {
      const result = await db.query(`SELECT COALESCE(status, 'active') as label, COUNT(*) as count, COALESCE(SUM("itemAmount"), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY label`, params);
      return res.json(result.rows);
    }
    if (chartType === 'pending') {
      const result = await db.query(`SELECT "customerName" as label, "pendingMoney" as amount, "billNo" FROM customer_records WHERE "pendingMoney" > 0 ${dateFilter} ORDER BY "pendingMoney" DESC LIMIT 20`, params);
      return res.json(result.rows);
    }
    if (chartType === 'monthly') {
      const result = await db.query(`SELECT TO_CHAR("createdAt", 'YYYY-MM') as label, COUNT(*) as count, COALESCE(SUM("itemAmount"), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY label ORDER BY label`, params);
      return res.json(result.rows);
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Parameterized /:id routes (MUST come after static routes) ──

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM customer_records WHERE id = $1', [req.params.id]);
    const record = result.rows[0];
    if (!record) return res.status(404).json({ error: 'Record not found' });
    record.extraMoney = record.extraMoney || [];
    record.moneyBack = record.moneyBack || [];
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, requirePermission('dataEntryAccess'), async (req, res) => {
  try {
    const oldResult = await db.query('SELECT * FROM customer_records WHERE id = $1', [req.params.id]);
    const oldRecord = oldResult.rows[0];
    if (!oldRecord) return res.status(404).json({ error: 'Record not found' });

    const {
      billNo, billDate, customerName, phoneNumber, address,
      itemName, itemType, itemAmount, interest, weight, purity,
      notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack, status
    } = req.body;

    if (!billNo || !customerName || !address || !itemName || !itemType || itemAmount == null || interest == null || weight == null) {
      return res.status(400).json({ error: 'Please fill all required fields' });
    }

    if (!ALLOWED_ITEM_TYPES.includes(itemType)) {
      return res.status(400).json({ error: 'Item type must be Gold or Silver' });
    }

    const dup = await db.query('SELECT id FROM customer_records WHERE "billNo" = $1 AND id != $2', [billNo, req.params.id]);
    if (dup.rows.length > 0) return res.status(400).json({ error: 'Bill number already exists' });

    await db.query(
      `UPDATE customer_records SET
        "billNo" = $1, "billDate" = $2, "customerName" = $3, "phoneNumber" = $4, address = $5,
        "itemName" = $6, "itemType" = $7, "itemAmount" = $8, interest = $9, weight = $10, purity = $11,
        notes = $12, "pendingMoney" = $13, "extraMoneyCount" = $14, "extraMoney" = $15::jsonb,
        "moneyBackCount" = $16, "moneyBack" = $17::jsonb, status = $18, "updatedAt" = NOW()
       WHERE id = $19`,
      [billNo.trim(), billDate || '', customerName.trim(), phoneNumber || '', address.trim(),
       itemName.trim(), itemType, parseFloat(itemAmount), parseFloat(interest), parseFloat(weight), purity || '',
       notes || '', parseFloat(pendingMoney) || 0, parseInt(extraMoneyCount) || 0, JSON.stringify(extraMoney || []),
       parseInt(moneyBackCount) || 0, JSON.stringify(moneyBack || []), status || oldRecord.status,
       req.params.id]
    );

    const updatedResult = await db.query('SELECT * FROM customer_records WHERE id = $1', [req.params.id]);
    const updated = updatedResult.rows[0];
    updated.extraMoney = updated.extraMoney || [];
    updated.moneyBack = updated.moneyBack || [];

    const changes = [];
    if (oldRecord.customerName !== updated.customerName) changes.push(`customerName: "${oldRecord.customerName}" → "${updated.customerName}"`);
    if (oldRecord.phoneNumber !== updated.phoneNumber) changes.push(`phoneNumber: "${oldRecord.phoneNumber}" → "${updated.phoneNumber}"`);
    if (oldRecord.address !== updated.address) changes.push(`address: "${oldRecord.address}" → "${updated.address}"`);
    if (oldRecord.itemName !== updated.itemName) changes.push(`itemName: "${oldRecord.itemName}" → "${updated.itemName}"`);
    if (oldRecord.itemType !== updated.itemType) changes.push(`itemType: "${oldRecord.itemType}" → "${updated.itemType}"`);
    if (oldRecord.itemAmount !== updated.itemAmount) changes.push(`itemAmount: "${oldRecord.itemAmount}" → "${updated.itemAmount}"`);
    if (oldRecord.interest !== updated.interest) changes.push(`interest: "${oldRecord.interest}" → "${updated.interest}"`);
    if (oldRecord.weight !== updated.weight) changes.push(`weight: "${oldRecord.weight}" → "${updated.weight}"`);
    if (oldRecord.purity !== updated.purity) changes.push(`purity: "${oldRecord.purity}" → "${updated.purity}"`);
    if (oldRecord.notes !== updated.notes) changes.push(`notes: "${oldRecord.notes}" → "${updated.notes}"`);
    if (oldRecord.billDate !== updated.billDate) changes.push(`billDate: "${oldRecord.billDate}" → "${updated.billDate}"`);
    if (oldRecord.status !== updated.status) changes.push(`status: "${oldRecord.status}" → "${updated.status}"`);
    if (oldRecord.pendingMoney !== updated.pendingMoney) changes.push(`pendingMoney: "${oldRecord.pendingMoney}" → "${updated.pendingMoney}"`);
    if ((oldRecord.extraMoneyCount || 0) !== (updated.extraMoneyCount || 0)) changes.push(`extraMoneyCount: "${oldRecord.extraMoneyCount || 0}" → "${updated.extraMoneyCount || 0}"`);
    if (JSON.stringify(oldRecord.extraMoney || []) !== JSON.stringify(updated.extraMoney || [])) changes.push(`extraMoney updated`);
    if ((oldRecord.moneyBackCount || 0) !== (updated.moneyBackCount || 0)) changes.push(`moneyBackCount: "${oldRecord.moneyBackCount || 0}" → "${updated.moneyBackCount || 0}"`);
    if (JSON.stringify(oldRecord.moneyBack || []) !== JSON.stringify(updated.moneyBack || [])) changes.push(`moneyBack updated`);

    await addAuditLog(db.query, 'UPDATE', req.params.id, updated, {
      message: `Record updated: ${updated.customerName}`,
      changes, previousData: oldRecord
    }, req.user);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/mark-sold', authenticateToken, async (req, res) => {
  try {
    const recResult = await db.query('SELECT * FROM customer_records WHERE id = $1', [req.params.id]);
    const record = recResult.rows[0];
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const changes = [];
    changes.push(`status: "${record.status || 'active'}" → "sold"`);
    if (record.pendingMoney > 0) changes.push(`pendingMoney: "${record.pendingMoney}" → "0 (settled on sale)"`);

    await addAuditLog(db.query, 'MARK_SOLD', req.params.id, record, {
      message: `Record marked as sold: ${record.customerName}`,
      previousStatus: record.status || 'active',
      changes
    }, req.user);

    await db.query("UPDATE customer_records SET status = 'sold', \"soldAt\" = NOW(), \"updatedAt\" = NOW() WHERE id = $1", [req.params.id]);

    const updatedResult = await db.query('SELECT * FROM customer_records WHERE id = $1', [req.params.id]);
    const updated = updatedResult.rows[0];
    updated.extraMoney = updated.extraMoney || [];
    updated.moneyBack = updated.moneyBack || [];
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM record_histories WHERE "recordId" = $1 ORDER BY timestamp DESC', [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
