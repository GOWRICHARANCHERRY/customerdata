const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken, adminOnly } = require('./auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function addAuditLog(action, recordId, recordData, details = {}, user) {
  const logEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    user: user.username,
    userRole: user.role || 'user',
    action,
    recordId,
    recordData: JSON.stringify(recordData || {}),
    details: JSON.stringify(details),
    billNumber: recordData ? recordData.billNo : null,
    customerName: recordData ? recordData.customerName : null
  };

  db.prepare(`INSERT INTO audit_logs (id, timestamp, user, userRole, action, recordId, recordData, details, billNumber, customerName)
    VALUES (@id, @timestamp, @user, @userRole, @action, @recordId, @recordData, @details, @billNumber, @customerName)`).run(logEntry);

  if (recordId) {
    db.prepare(`INSERT INTO record_histories (id, recordId, timestamp, user, userRole, action, recordData, details, billNumber, customerName)
      VALUES (@id, @recordId, @timestamp, @user, @userRole, @action, @recordData, @details, @billNumber, @customerName)`).run(logEntry);
  }
}

router.get('/', authenticateToken, (req, res) => {
  try {
    let query = 'SELECT * FROM customer_records WHERE 1=1';
    const params = [];

    const { filterType, filterStatus, minAmount, maxAmount, pendingFilter, sortBy, searchType, searchValue } = req.query;

    if (filterType) {
      query += ' AND itemType = ?';
      params.push(filterType);
    }
    if (filterStatus) {
      if (filterStatus === 'active') {
        query += " AND (status IS NULL OR status = 'active')";
      } else {
        query += ' AND status = ?';
        params.push(filterStatus);
      }
    }
    if (minAmount) {
      query += ' AND itemAmount >= ?';
      params.push(parseFloat(minAmount));
    }
    if (maxAmount) {
      query += ' AND itemAmount <= ?';
      params.push(parseFloat(maxAmount));
    }
    if (pendingFilter === 'pending') {
      query += ' AND pendingMoney > 0';
    } else if (pendingFilter === 'no-pending') {
      query += ' AND (pendingMoney IS NULL OR pendingMoney = 0)';
    }

    if (searchValue) {
      if (searchType === 'billNo') {
        query += ' AND (billNo LIKE ?)';
        params.push(`%${searchValue}%`);
      } else if (searchType) {
        query += ` AND ${searchType} LIKE ?`;
        params.push(`%${searchValue}%`);
      }
    }

    switch (sortBy) {
      case 'oldest': query += ' ORDER BY createdAt ASC'; break;
      case 'amount-high': query += ' ORDER BY itemAmount DESC'; break;
      case 'amount-low': query += ' ORDER BY itemAmount ASC'; break;
      case 'name': query += ' ORDER BY customerName ASC'; break;
      case 'pending-high': query += ' ORDER BY pendingMoney DESC'; break;
      default: query += ' ORDER BY createdAt DESC';
    }

    const records = db.prepare(query).all(...params);
    const parsed = records.map(r => ({
      ...r,
      extraMoney: JSON.parse(r.extraMoney || '[]'),
      moneyBack: JSON.parse(r.moneyBack || '[]')
    }));

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const {
      billNo, billDate, customerName, phoneNumber, address,
      itemName, itemType, itemAmount, interest, weight, purity,
      notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack
    } = req.body;

    if (!billNo || !customerName || !address || !itemName || !itemType || itemAmount == null || interest == null || weight == null) {
      return res.status(400).json({ error: 'Please fill all required fields' });
    }

    const existing = db.prepare('SELECT id FROM customer_records WHERE billNo = ?').get(billNo);
    if (existing) {
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
      extraMoney: JSON.stringify(extraMoney || []),
      moneyBackCount: parseInt(moneyBackCount) || 0,
      moneyBack: JSON.stringify(moneyBack || []),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: req.user.username
    };

    db.prepare(`INSERT INTO customer_records (id, billNo, billDate, customerName, phoneNumber, address, itemName, itemType, itemAmount, interest, weight, purity, notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack, status, createdAt, createdBy)
      VALUES (@id, @billNo, @billDate, @customerName, @phoneNumber, @address, @itemName, @itemType, @itemAmount, @interest, @weight, @purity, @notes, @pendingMoney, @extraMoneyCount, @extraMoney, @moneyBackCount, @moneyBack, @status, @createdAt, @createdBy)`).run(record);

    const createdRecord = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(id);
    createdRecord.extraMoney = JSON.parse(createdRecord.extraMoney || '[]');
    createdRecord.moneyBack = JSON.parse(createdRecord.moneyBack || '[]');

    addAuditLog('CREATE', id, createdRecord, {
      message: `New customer record created: ${customerName}`,
      itemType, amount: itemAmount
    }, req.user);

    res.json(createdRecord);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/next-bill-no', authenticateToken, (req, res) => {
  try {
    const last = db.prepare("SELECT billNo FROM customer_records ORDER BY CAST(REPLACE(billNo, 'BILL', '') AS INTEGER) DESC LIMIT 1").get();
    let next = 1;
    if (last) {
      const num = parseInt(last.billNo.replace(/\D/g, ''));
      next = (num || 0) + 1;
    }
    res.json({ nextBillNo: next });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const record = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    record.extraMoney = JSON.parse(record.extraMoney || '[]');
    record.moneyBack = JSON.parse(record.moneyBack || '[]');
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, (req, res) => {
  try {
    const oldRecord = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(req.params.id);
    if (!oldRecord) return res.status(404).json({ error: 'Record not found' });

    const {
      billNo, billDate, customerName, phoneNumber, address,
      itemName, itemType, itemAmount, interest, weight, purity,
      notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack, status
    } = req.body;

    if (!billNo || !customerName || !address || !itemName || !itemType || itemAmount == null || interest == null || weight == null) {
      return res.status(400).json({ error: 'Please fill all required fields' });
    }

    const dup = db.prepare('SELECT id FROM customer_records WHERE billNo = ? AND id != ?').get(billNo, req.params.id);
    if (dup) return res.status(400).json({ error: 'Bill number already exists' });

    db.prepare(`UPDATE customer_records SET
      billNo = ?, billDate = ?, customerName = ?, phoneNumber = ?, address = ?,
      itemName = ?, itemType = ?, itemAmount = ?, interest = ?, weight = ?, purity = ?,
      notes = ?, pendingMoney = ?, extraMoneyCount = ?, extraMoney = ?,
      moneyBackCount = ?, moneyBack = ?, status = ?, updatedAt = datetime('now')
      WHERE id = ?`).run(
      billNo.trim(), billDate || '', customerName.trim(), phoneNumber || '', address.trim(),
      itemName.trim(), itemType, parseFloat(itemAmount), parseFloat(interest), parseFloat(weight), purity || '',
      notes || '', parseFloat(pendingMoney) || 0, parseInt(extraMoneyCount) || 0, JSON.stringify(extraMoney || []),
      parseInt(moneyBackCount) || 0, JSON.stringify(moneyBack || []), status || oldRecord.status,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(req.params.id);
    updated.extraMoney = JSON.parse(updated.extraMoney || '[]');
    updated.moneyBack = JSON.parse(updated.moneyBack || '[]');

    const changes = [];
    if (oldRecord.customerName !== updated.customerName) changes.push(`customerName: "${oldRecord.customerName}" → "${updated.customerName}"`);
    if (oldRecord.itemAmount !== updated.itemAmount) changes.push(`itemAmount: "${oldRecord.itemAmount}" → "${updated.itemAmount}"`);
    if (oldRecord.status !== updated.status) changes.push(`status: "${oldRecord.status}" → "${updated.status}"`);
    if (oldRecord.pendingMoney !== updated.pendingMoney) changes.push(`pendingMoney: "${oldRecord.pendingMoney}" → "${updated.pendingMoney}"`);

    addAuditLog('UPDATE', req.params.id, updated, {
      message: `Record updated: ${updated.customerName}`,
      changes, previousData: oldRecord
    }, req.user);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/bulk-delete', authenticateToken, (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No record IDs provided' });

    const deleteStmt = db.prepare('DELETE FROM customer_records WHERE id = ?');
    const deleteMany = db.transaction((ids) => {
      for (const id of ids) {
        const record = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(id);
        if (record) {
          addAuditLog('DELETE', id, record, {
            message: `Bulk delete: ${record.customerName}`, billNumber: record.billNo
          }, req.user);
          deleteStmt.run(id);
        }
      }
    });
    deleteMany(ids);

    res.json({ message: `${ids.length} record(s) deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-mark-sold', authenticateToken, (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No record IDs provided' });

    const updateStmt = db.prepare("UPDATE customer_records SET status = 'sold', soldAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?");
    const updateMany = db.transaction((ids) => {
      for (const id of ids) {
        const record = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(id);
        if (record) {
          addAuditLog('MARK_SOLD', id, record, {
            message: `Bulk mark sold: ${record.customerName}`,
            previousStatus: record.status || 'active'
          }, req.user);
          updateStmt.run(id);
        }
      }
    });
    updateMany(ids);

    res.json({ message: `${ids.length} record(s) marked as sold` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/mark-sold', authenticateToken, (req, res) => {
  try {
    const record = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    addAuditLog('MARK_SOLD', req.params.id, record, {
      message: `Record marked as sold: ${record.customerName}`,
      previousStatus: record.status || 'active'
    }, req.user);

    db.prepare("UPDATE customer_records SET status = 'sold', soldAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?").run(req.params.id);

    const updated = db.prepare('SELECT * FROM customer_records WHERE id = ?').get(req.params.id);
    updated.extraMoney = JSON.parse(updated.extraMoney || '[]');
    updated.moneyBack = JSON.parse(updated.moneyBack || '[]');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/history', authenticateToken, (req, res) => {
  try {
    const history = db.prepare('SELECT * FROM record_histories WHERE recordId = ? ORDER BY timestamp DESC').all(req.params.id);
    const parsed = history.map(h => ({ ...h, details: JSON.parse(h.details || '{}'), recordData: JSON.parse(h.recordData || '{}') }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit-logs/all', authenticateToken, adminOnly, (req, res) => {
  try {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    const { actionFilter, userFilter, dateFilter } = req.query;
    if (actionFilter) { query += ' AND action = ?'; params.push(actionFilter); }
    if (userFilter) { query += ' AND user = ?'; params.push(userFilter); }
    if (dateFilter) { query += " AND date(timestamp) = date(?)"; params.push(dateFilter); }

    query += ' ORDER BY timestamp DESC';
    const logs = db.prepare(query).all(...params);
    const parsed = logs.map(l => ({ ...l, details: JSON.parse(l.details || '{}'), recordData: JSON.parse(l.recordData || '{}') }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit-logs/users', authenticateToken, adminOnly, (req, res) => {
  try {
    const users = db.prepare('SELECT DISTINCT user FROM audit_logs ORDER BY user').all();
    res.json(users.map(u => u.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/summary', authenticateToken, (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let dateFilter = '';
    const params = [];
    if (dateFrom) { dateFilter += ' AND DATE(createdAt) >= DATE(?)'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND DATE(createdAt) <= DATE(?)'; params.push(dateTo); }

    const totalRecords = db.prepare(`SELECT COUNT(*) as count FROM customer_records WHERE 1=1 ${dateFilter}`).get(...params);
    const totalActive = db.prepare(`SELECT COUNT(*) as count FROM customer_records WHERE (status IS NULL OR status = 'active') ${dateFilter}`).get(...params);
    const totalSold = db.prepare(`SELECT COUNT(*) as count FROM customer_records WHERE status = 'sold' ${dateFilter}`).get(...params);
    const totalAmount = db.prepare(`SELECT COALESCE(SUM(itemAmount), 0) as total FROM customer_records WHERE 1=1 ${dateFilter}`).get(...params);
    const totalPending = db.prepare(`SELECT COALESCE(SUM(pendingMoney), 0) as total FROM customer_records WHERE 1=1 ${dateFilter}`).get(...params);
    const goldCount = db.prepare(`SELECT COUNT(*) as count FROM customer_records WHERE itemType = 'Gold' ${dateFilter}`).get(...params);
    const silverCount = db.prepare(`SELECT COUNT(*) as count FROM customer_records WHERE itemType = 'Silver' ${dateFilter}`).get(...params);

    res.json({
      totalRecords: totalRecords.count,
      totalActive: totalActive.count,
      totalSold: totalSold.count,
      totalAmount: totalAmount.total,
      totalPending: totalPending.total,
      goldCount: goldCount.count,
      silverCount: silverCount.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/chart', authenticateToken, (req, res) => {
  try {
    const { dateFrom, dateTo, chartType } = req.query;
    let dateFilter = '';
    const params = [];
    if (dateFrom) { dateFilter += ' AND DATE(createdAt) >= DATE(?)'; params.push(dateFrom); }
    if (dateTo) { dateFilter += ' AND DATE(createdAt) <= DATE(?)'; params.push(dateTo); }

    if (chartType === 'sales') {
      const data = db.prepare(`SELECT DATE(createdAt) as label, COUNT(*) as count, COALESCE(SUM(itemAmount), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY DATE(createdAt) ORDER BY label`).all(...params);
      return res.json(data);
    }
    if (chartType === 'itemType') {
      const data = db.prepare(`SELECT itemType as label, COUNT(*) as count, COALESCE(SUM(itemAmount), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY itemType`).all(...params);
      return res.json(data);
    }
    if (chartType === 'status') {
      const data = db.prepare(`SELECT COALESCE(status, 'active') as label, COUNT(*) as count, COALESCE(SUM(itemAmount), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY label`).all(...params);
      return res.json(data);
    }
    if (chartType === 'pending') {
      const data = db.prepare(`SELECT customerName as label, pendingMoney as amount, billNo FROM customer_records WHERE pendingMoney > 0 ${dateFilter} ORDER BY pendingMoney DESC LIMIT 20`).all(...params);
      return res.json(data);
    }
    if (chartType === 'monthly') {
      const data = db.prepare(`SELECT strftime('%Y-%m', createdAt) as label, COUNT(*) as count, COALESCE(SUM(itemAmount), 0) as amount FROM customer_records WHERE 1=1 ${dateFilter} GROUP BY label ORDER BY label`).all(...params);
      return res.json(data);
    }

    res.json([]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-excel', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!jsonData.length) return res.status(400).json({ error: 'Empty file' });

    const imported = [];
    const errors = [];

    const insertStmt = db.prepare(`INSERT OR IGNORE INTO customer_records
      (id, billNo, billDate, customerName, phoneNumber, address, itemName, itemType, itemAmount, interest, weight, purity, notes, pendingMoney, extraMoneyCount, extraMoney, moneyBackCount, moneyBack, status, createdAt, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const insertMany = db.transaction(() => {
      jsonData.forEach((row, index) => {
        try {
          const billNo = (row['Bill Number'] || '').toString().trim();
          if (!billNo) { errors.push(`Row ${index + 2}: Missing Bill Number`); return; }

          const existing = db.prepare('SELECT id FROM customer_records WHERE billNo = ?').get(billNo);
          if (existing) { errors.push(`Row ${index + 2}: Bill ${billNo} already exists`); return; }

          const itemType = (row['Item Type'] || '').toString().trim();
          if (itemType !== 'Gold' && itemType !== 'Silver') { errors.push(`Row ${index + 2}: Item type must be Gold/Silver`); return; }

          const id = uuidv4();
          insertStmt.run(
            id, billNo, row['Bill Date'] || '', (row['Customer Name'] || '').toString().trim(),
            (row['Phone Number'] || '').toString().trim(), (row['Address'] || '').toString().trim(),
            (row['Item Name'] || '').toString().trim(), itemType,
            parseFloat(row['Item Amount']) || 0, parseFloat(row['Interest (%)']) || 0,
            parseFloat(row['Weight (grams)']) || 0, (row['Purity'] || '').toString().trim(),
            (row['Notes'] || '').toString().trim(), parseFloat(row['Pending Money']) || 0,
            parseInt(row['Extra Money Count']) || 0, '[]', parseInt(row['Money Back Count']) || 0, '[]',
            ((row['Status'] || 'active').toString().toLowerCase() === 'sold' ? 'sold' : 'active'),
            new Date().toISOString(), req.user.username
          );
          imported.push(billNo);
        } catch (e) {
          errors.push(`Row ${index + 2}: ${e.message}`);
        }
      });
    });

    insertMany();

    res.json({
      imported: imported.length,
      errors: errors.length,
      errorDetails: errors,
      message: `Imported ${imported.length} records. ${errors.length} errors.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export-excel', authenticateToken, (req, res) => {
  try {
    const records = db.prepare('SELECT * FROM customer_records ORDER BY createdAt DESC').all();
    const excelData = records.map(r => ({
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
      'Pending Money': r.pendingMoney || 0,
      'Extra Money Count': r.extraMoneyCount || 0,
      'Money Back Count': r.moneyBackCount || 0,
      'Notes': r.notes || '',
      'Status': r.status || 'active'
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Records');

    const filename = `customer_records_${new Date().toISOString().split('T')[0]}.xlsx`;
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/download-template', authenticateToken, (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
