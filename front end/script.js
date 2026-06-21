

// Audit log system
function addAuditLog(action, recordId, recordData, details = {}) {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;
    
    const auditLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    const logEntry = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        user: currentUser.username,
        userRole: currentUser.role || 'user',
        action: action, // 'CREATE', 'UPDATE', 'DELETE', 'MARK_SOLD'
        recordId: recordId,
        recordData: recordData,
        details: details,
        billNumber: recordData ? recordData.billNo : null,
        customerName: recordData ? recordData.customerName : null
    };
    
    auditLogs.push(logEntry);
    localStorage.setItem('auditLogs', JSON.stringify(auditLogs));
    
    // Also add to record-specific history
    if (recordId) {
        addRecordHistory(recordId, logEntry);
    }
}

function addRecordHistory(recordId, logEntry) {
    const recordHistories = JSON.parse(localStorage.getItem('recordHistories') || '{}');
    if (!recordHistories[recordId]) {
        recordHistories[recordId] = [];
    }
    recordHistories[recordId].push(logEntry);
    localStorage.setItem('recordHistories', JSON.stringify(recordHistories));
}

function getRecordHistory(recordId) {
    const recordHistories = JSON.parse(localStorage.getItem('recordHistories') || '{}');
    return recordHistories[recordId] || [];
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first
    checkAuthentication();
    
    document.getElementById('dataEntryForm').addEventListener('submit', saveRecord);
    document.getElementById('editForm').addEventListener('submit', updateRecord);
    document.getElementById('billDate').value = new Date().toISOString().split('T')[0];
    
    // Auto-generate first bill number
    generateBillNumber();
    
    // Load all records on startup
    loadAllRecords();
});

// Check authentication
function checkAuthentication() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    if (!currentUser) {
        window.location.href = 'login.html';
        return;
    }
    
    const users = JSON.parse(localStorage.getItem('users') || '{}');
    const userData = users[currentUser.username];

    if (currentUser.role !== 'admin') {
        if (!userData || !userData.dataEntryAccess) {
            alert('Access Denied: You do not have permission to access the Data Entry system. Please contact your administrator.');
            window.location.href = 'simple13.html';
            return;
        }
        if (!userData.excelAccess) {
            document.querySelector('.tab[onclick="showTab(\'excel\')"]').style.display = 'none';
        }
        if (!userData.auditAccess) {
            document.getElementById('auditTab').style.display = 'none';
        }
        if (!userData.analyticsAccess) {
            document.querySelector('.tab[onclick="showTab(\'analytics\')"]').style.display = 'none';
        }
    } else {
         document.getElementById('auditTab').style.display = 'block';
    }

    const roleText = currentUser.role === 'admin' ? ' (Admin)' : '';
    document.getElementById('currentUserName').textContent = `Welcome, ${currentUser.username}!${roleText}`;
}

// Logout function
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

// Tab switching functionality
function showTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab content
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // Add active class to selected tab
    event.target.classList.add('active');
    
    // Load all records when switching to all records tab
    if (tabName === 'all') {
        loadAllRecords();
    }
    
    // Load audit logs when switching to audit tab
    if (tabName === 'audit') {
        loadAuditLogs();
    }
    
    // Load analytics when switching to analytics tab
    if (tabName === 'analytics') {
        // Set default date range (last 30 days)
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        document.getElementById('analyticsDateFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
        document.getElementById('analyticsDateTo').value = today.toISOString().split('T')[0];
        
        updateAnalytics();
    }

    // Clear selections when switching tabs
    clearSelection('search');
    clearSelection('all');
}

// Auto-generate bill number
function generateBillNumber() {
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    let maxBillNo = 0;
    
    records.forEach(record => {
        const billNoNum = parseInt(record.billNo.replace(/\D/g, ''));
        if (billNoNum > maxBillNo) {
            maxBillNo = billNoNum;
        }
    });
    
    const nextBillNo = maxBillNo + 1;
    document.getElementById('billNo').value = nextBillNo;
}

// Generate extra money fields
function generateExtraMoneyFields() {
    const count = parseInt(document.getElementById('extraMoneyCount').value);
    const container = document.getElementById('extraMoneyContainer');
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const section = document.createElement('div');
        section.className = 'extra-money-section';
        section.innerHTML = `
            <h4>${getOrdinal(i)} Extra Money Taken</h4>
            <div class="extra-money-fields">
                <div>
                    <label>Amount:</label>
                    <input type="number" id="extraAmount${i}" placeholder="Enter extra amount">
                </div>
                <div>
                    <label>Start Date:</label>
                    <input type="date" id="extraStartDate${i}">
                </div>
            </div>
        `;
        container.appendChild(section);
    }
}

// Generate money back fields
function generateMoneyBackFields() {
    const count = parseInt(document.getElementById('moneyBackCount').value);
    const container = document.getElementById('moneyBackContainer');
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const section = document.createElement('div');
        section.className = 'money-back-section';
        section.innerHTML = `
            <h4>${getOrdinal(i)} Money Given Back</h4>
            <div class="extra-money-fields">
                <div>
                    <label>Amount:</label>
                    <input type="number" id="backAmount${i}" placeholder="Enter repayment amount">
                </div>
                <div>
                    <label>Payment Date:</label>
                    <input type="date" id="backDate${i}">
                </div>
            </div>
        `;
        container.appendChild(section);
    }
}

function getOrdinal(num) {
    const ordinals = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
    return ordinals[num];
}

// Generate edit extra money fields
function generateEditExtraMoneyFields() {
    const count = parseInt(document.getElementById('editExtraMoneyCount').value);
    const container = document.getElementById('editExtraMoneyContainer');
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const section = document.createElement('div');
        section.className = 'extra-money-section';
        section.innerHTML = `
            <h4>${getOrdinal(i)} Extra Money Taken</h4>
            <div class="extra-money-fields">
                <div>
                    <label>Amount:</label>
                    <input type="number" id="editExtraAmount${i}" placeholder="Enter extra amount">
                </div>
                <div>
                    <label>Start Date:</label>
                    <input type="date" id="editExtraStartDate${i}">
                </div>
            </div>
        `;
        container.appendChild(section);
    }
}

// Generate edit money back fields
function generateEditMoneyBackFields() {
    const count = parseInt(document.getElementById('editMoneyBackCount').value);
    const container = document.getElementById('editMoneyBackContainer');
    container.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const section = document.createElement('div');
        section.className = 'money-back-section';
        section.innerHTML = `
            <h4>${getOrdinal(i)} Money Given Back</h4>
            <div class="extra-money-fields">
                <div>
                    <label>Amount:</label>
                    <input type="number" id="editBackAmount${i}" placeholder="Enter repayment amount">
                </div>
                <div>
                    <label>Payment Date:</label>
                    <input type="date" id="editBackDate${i}">
                </div>
            </div>
        `;
        container.appendChild(section);
    }
}

// Save record functionality
function saveRecord(e) {
    e.preventDefault();
    
    // Get form data
    const extraMoneyCount = parseInt(document.getElementById('extraMoneyCount').value) || 0;
    const moneyBackCount = parseInt(document.getElementById('moneyBackCount').value) || 0;
    
    // Collect extra money data
    const extraMoney = [];
    for (let i = 1; i <= extraMoneyCount; i++) {
        const amount = document.getElementById(`extraAmount${i}`)?.value;
        const date = document.getElementById(`extraStartDate${i}`)?.value;
        if (amount && date) {
            extraMoney.push({
                amount: parseFloat(amount),
                startDate: date
            });
        }
    }
    
    // Collect money back data
    const moneyBack = [];
    for (let i = 1; i <= moneyBackCount; i++) {
        const amount = document.getElementById(`backAmount${i}`)?.value;
        const date = document.getElementById(`backDate${i}`)?.value;
        if (amount && date) {
            moneyBack.push({
                amount: parseFloat(amount),
                paymentDate: date
            });
        }
    }
    
    const record = {
        id: Date.now().toString(),
        billNo: document.getElementById('billNo').value.trim(),
        billDate: document.getElementById('billDate').value,
        customerName: document.getElementById('customerName').value.trim(),
        phoneNumber: document.getElementById('phoneNumber').value.trim(),
        address: document.getElementById('address').value.trim(),
        itemName: document.getElementById('itemName').value.trim(),
        itemType: document.getElementById('itemType').value,
        itemAmount: parseFloat(document.getElementById('itemAmount').value),
        interest: parseFloat(document.getElementById('interest').value),
        weight: parseFloat(document.getElementById('weight').value),
        purity: document.getElementById('purity').value.trim(),
        notes: document.getElementById('notes').value.trim(),
        pendingMoney: parseFloat(document.getElementById('pendingMoney').value) || 0,
        extraMoneyCount: extraMoneyCount,
        extraMoney: extraMoney,
        moneyBackCount: moneyBackCount,
        moneyBack: moneyBack,
        status: 'active',
        createdAt: new Date().toISOString()
    };

    // Validate required fields
    if (!record.billNo || !record.customerName || !record.address || !record.itemName || 
        !record.itemType || isNaN(record.itemAmount) || isNaN(record.interest) || isNaN(record.weight)) {
        showMessage('entryMessage', 'Please fill all required fields correctly.', 'error');
        return;
    }

    // Get existing records
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    // Check if bill number already exists
    if (records.find(r => r.billNo === record.billNo)) {
        showMessage('entryMessage', 'Bill number already exists. Please use a different bill number.', 'error');
        return;
    }

    // Add new record
    records.push(record);
    
    // Save to localStorage
    localStorage.setItem('customerRecords', JSON.stringify(records));
    
    // Add audit log
    addAuditLog('CREATE', record.id, record, {
        message: `New customer record created: ${record.customerName}`,
        itemType: record.itemType,
        amount: record.itemAmount
    });
    
    // Show success message
    showMessage('entryMessage', 'Record saved successfully!', 'success');
    
    // Clear form and auto-generate next bill number
    clearForm();
    generateBillNumber();
}

// Clear form functionality
function clearForm() {
    document.getElementById('dataEntryForm').reset();
    document.getElementById('billDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('entryMessage').innerHTML = '';
    document.getElementById('extraMoneyContainer').innerHTML = '';
    document.getElementById('moneyBackContainer').innerHTML = '';
}

// Search records functionality
function searchRecords() {
    const searchType = document.getElementById('searchType').value;
    const searchValue = document.getElementById('searchValue').value.trim().toLowerCase();
    
    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');

    // Apply search filter if search value is provided
    if (searchValue) {
        records = records.filter(record => {
            if (searchType === 'billNo') {
                return record.billNo.toLowerCase().includes(searchValue) || (record.previousBillNumbers && record.previousBillNumbers.join(', ').toLowerCase().includes(searchValue));
            } else {
                const fieldValue = record[searchType]?.toString().toLowerCase() || '';
                return fieldValue.includes(searchValue);
            }
        });
    }

    // Apply additional filters
    records = applyFilters(records, 'search');

    displayRecords(records, 'searchResults', 'search');
}

// Apply filters functionality
function applyFilters(records, context) {
    const prefix = context === 'search' ? 'search' : 'all';
    
    const filterType = document.getElementById(prefix + 'FilterType').value;
    const filterStatus = document.getElementById(prefix + 'FilterStatus').value;
    const minAmount = document.getElementById(prefix + 'MinAmount').value;
    const maxAmount = document.getElementById(prefix + 'MaxAmount').value;
    const pendingFilter = document.getElementById(prefix + 'PendingFilter').value;

    let filteredRecords = records;

    // Filter by item type
    if (filterType) {
        filteredRecords = filteredRecords.filter(record => record.itemType === filterType);
    }

    // Filter by status
    if (filterStatus) {
        if (filterStatus === 'active') {
            filteredRecords = filteredRecords.filter(record => !record.status || record.status === 'active');
        } else if (filterStatus === 'sold') {
            filteredRecords = filteredRecords.filter(record => record.status === 'sold');
        }
    }

    // Filter by amount range
    if (minAmount) {
        filteredRecords = filteredRecords.filter(record => record.itemAmount >= parseFloat(minAmount));
    }
    if (maxAmount) {
        filteredRecords = filteredRecords.filter(record => record.itemAmount <= parseFloat(maxAmount));
    }

    // Filter by pending money
    if (pendingFilter) {
        if (pendingFilter === 'pending') {
            filteredRecords = filteredRecords.filter(record => record.pendingMoney && record.pendingMoney > 0);
        } else if (pendingFilter === 'no-pending') {
            filteredRecords = filteredRecords.filter(record => !record.pendingMoney || record.pendingMoney === 0);
        }
    }

    return filteredRecords;
}

// Load all records functionality
function loadAllRecords() {
    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    // Apply filters
    records = applyFilters(records, 'all');

    // Apply sorting
    const sortBy = document.getElementById('sortBy').value;
    switch(sortBy) {
        case 'oldest':
            records.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            break;
        case 'amount-high':
            records.sort((a, b) => b.itemAmount - a.itemAmount);
            break;
        case 'amount-low':
            records.sort((a, b) => a.itemAmount - b.itemAmount);
            break;
        case 'name':
            records.sort((a, b) => a.customerName.localeCompare(b.customerName));
            break;
        case 'pending-high':
            records.sort((a, b) => (b.pendingMoney || 0) - (a.pendingMoney || 0));
            break;
        default: // newest
            records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    displayRecords(records, 'allRecords', 'all');
}

// Selection functionality
function toggleRecordSelection(recordId, context) {
    if (selectedRecords[context].has(recordId)) {
        selectedRecords[context].delete(recordId);
    } else {
        selectedRecords[context].add(recordId);
    }
    
    updateSelectionUI(context);
}

function selectAll(context) {
    const checkboxes = document.querySelectorAll(`#${context}Records .record-checkbox`);
    const selectAllCheckbox = document.getElementById(`${context}SelectAll`);
    
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
        const recordId = checkbox.dataset.recordId;
        
        if (selectAllCheckbox.checked) {
            selectedRecords[context].add(recordId);
        } else {
            selectedRecords[context].delete(recordId);
        }
    });
    
    updateSelectionUI(context);
}

function updateSelectionUI(context) {
    const selectedCount = selectedRecords[context].size;
    const bulkActions = document.getElementById(`${context}BulkActions`);
    const selectedCountSpan = document.getElementById(`${context}SelectedCount`);
    
    if (selectedCount > 0) {
        bulkActions.classList.add('show');
        selectedCountSpan.textContent = `${selectedCount} selected`;
    } else {
        bulkActions.classList.remove('show');
        selectedCountSpan.textContent = '0 selected';
    }

    // Update select all checkbox state
    const selectAllCheckbox = document.getElementById(`${context}SelectAll`);
    const totalCheckboxes = document.querySelectorAll(`#${context}Records .record-checkbox`).length;
    
    if (selectAllCheckbox) {
        if (selectedCount === 0) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = false;
        } else if (selectedCount === totalCheckboxes) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = true;
        } else {
            selectAllCheckbox.indeterminate = true;
            selectAllCheckbox.checked = false;
        }
    }
}

function clearSelection(context) {
    selectedRecords[context].clear();
    
    // Uncheck all checkboxes
    const checkboxes = document.querySelectorAll(`#${context}Records .record-checkbox`);
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Uncheck select all checkbox
    const selectAllCheckbox = document.getElementById(`${context}SelectAll`);
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
    
    updateSelectionUI(context);
}

// Bulk operations
function bulkMarkAsSold(context) {
    const selectedIds = Array.from(selectedRecords[context]);
    
    if (selectedIds.length === 0) {
        alert('Please select records to mark as sold.');
        return;
    }

    if (!confirm(`Are you sure you want to mark ${selectedIds.length} record(s) as sold?`)) {
        return;
    }

    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    selectedIds.forEach(recordId => {
        const recordIndex = records.findIndex(r => r.id === recordId);
        if (recordIndex !== -1) {
            const oldRecord = {...records[recordIndex]};
            records[recordIndex].status = 'sold';
            records[recordIndex].soldAt = new Date().toISOString();
            
            // Add audit log for each record
            addAuditLog('MARK_SOLD', recordId, records[recordIndex], {
                message: `Bulk operation: Record marked as sold - ${records[recordIndex].customerName}`,
                previousStatus: oldRecord.status || 'active',
                bulkOperation: true,
                totalRecords: selectedIds.length
            });
        }
    });

    localStorage.setItem('customerRecords', JSON.stringify(records));
    
    // Clear selection and refresh display
    clearSelection(context);
    
    if (context === 'all') {
        loadAllRecords();
    } else {
        searchRecords();
    }
    
    alert(`${selectedIds.length} record(s) marked as sold successfully!`);
}

function bulkDelete(context) {
    const selectedIds = Array.from(selectedRecords[context]);
    
    if (selectedIds.length === 0) {
        alert('Please select records to delete.');
        return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedIds.length} record(s)?\n\nThis action cannot be undone.`)) {
        return;
    }

    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    // Add audit logs for deleted records
    selectedIds.forEach(recordId => {
        const recordToDelete = records.find(r => r.id === recordId);
        if (recordToDelete) {
            addAuditLog('DELETE', recordId, recordToDelete, {
                message: `Bulk operation: Record deleted - ${recordToDelete.customerName}`,
                billNumber: recordToDelete.billNo,
                bulkOperation: true,
                totalRecords: selectedIds.length
            });
        }
    });
    
    records = records.filter(record => !selectedIds.includes(record.id));
    localStorage.setItem('customerRecords', JSON.stringify(records));
    
    // Clear selection and refresh display
    clearSelection(context);
    
    if (context === 'all') {
        loadAllRecords();
    } else {
        searchRecords();
    }
    
    alert(`${selectedIds.length} record(s) deleted successfully!`);
}

// Display records functionality
function displayRecords(records, containerId, context) {
    const container = document.getElementById(containerId);
    
    // Clear previous selections for this context
    selectedRecords[context].clear();
    
    // Add record count
    let countHtml = `<div class="record-count">Total Records: ${records.length}</div>`;
    
    if (records.length === 0) {
        container.innerHTML = countHtml + '<div class="no-records">No records found</div>';
        updateSelectionUI(context);
        return;
    }

    // Add select all option
    let html = countHtml + `
        <div class="select-all-container">
            <input type="checkbox" id="${context}SelectAll" onchange="selectAll('${context}')">
            <label for="${context}SelectAll" style="margin-left: 5px; font-weight: 600;">Select All</label>
        </div>
    `;
    
    records.forEach(record => {
        const isSold = record.status === 'sold';
        const soldBadge = isSold ? '<span class="sold-badge">SOLD</span>' : '';

        html += `
            <div class="record-card ${isSold ? 'sold' : ''}">
                <input type="checkbox" class="record-checkbox" data-record-id="${record.id}" onchange="toggleRecordSelection('${record.id}', '${context}')">
                <div class="record-header">
                    <h4>Bill #${record.billNo} ${soldBadge}</h4>
                    <div>
                        <button class="btn btn-info" onclick="showRecordHistory('${record.id}')" title="View History">📊 History</button>
                        <button class="btn btn-warning" onclick="editRecord('${record.id}')">Edit</button>
                        ${!isSold ? `<button class="btn btn-success" onclick="markAsSold('${record.id}', '${context}')">Mark as Sold</button>` : ''}
                        <button class="btn btn-danger" onclick="confirmDelete('${record.id}', '${context}')">Delete</button>
                    </div>
                </div>
                <div class="record-details">
                    <div class="record-detail">
                        <strong>Customer Name</strong>
                        <span>${record.customerName}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Phone Number</strong>
                        <span>${record.phoneNumber || 'N/A'}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Bill Date</strong>
                        <span>${record.billDate ? new Date(record.billDate).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Item Name</strong>
                        <span>${record.itemName}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Item Type</strong>
                        <span>${record.itemType}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Amount</strong>
                        <span>₹${record.itemAmount.toLocaleString()}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Interest</strong>
                        <span>${record.interest}%</span>
                    </div>
                    <div class="record-detail">
                        <strong>Weight</strong>
                        <span>${record.weight}g</span>
                    </div>
                    ${record.purity ? `
                    <div class="record-detail">
                        <strong>Purity</strong>
                        <span>${record.purity}</span>
                    </div>
                    ` : ''}
                    <div class="record-detail">
                        <strong>Address</strong>
                        <span>${record.address}</span>
                    </div>
                    ${record.extraMoneyCount > 0 ? `
                    <div class="record-detail">
                        <strong>Extra Money Taken</strong>
                        <span>${record.extraMoneyCount} time(s)</span>
                    </div>
                    ` : ''}
                    ${record.moneyBackCount > 0 ? `
                    <div class="record-detail">
                        <strong>Money Given Back</strong>
                        <span>${record.moneyBackCount} time(s)</span>
                    </div>
                    ` : ''}
                    ${record.pendingMoney > 0 ? `
                    <div class="record-detail">
                        <strong>Pending Money</strong>
                        <span style="color: #dc3545; font-weight: bold;">₹${record.pendingMoney.toLocaleString()}</span>
                    </div>
                    ` : ''}
                    ${record.notes ? `
                    <div class="record-detail">
                        <strong>Notes</strong>
                        <span>${record.notes}</span>
                    </div>
                    ` : ''}
                    ${isSold && record.soldAt ? `
                    <div class="record-detail">
                        <strong>Sold Date</strong>
                        <span>${new Date(record.soldAt).toLocaleDateString()}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    updateSelectionUI(context);
}

// Mark single record as sold
function markAsSold(recordId, context) {
    if (!confirm('Are you sure you want to mark this record as sold?')) {
        return;
    }

    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    const recordIndex = records.findIndex(r => r.id === recordId);
    
    if (recordIndex !== -1) {
        const oldRecord = {...records[recordIndex]};
        records[recordIndex].status = 'sold';
        records[recordIndex].soldAt = new Date().toISOString();
        localStorage.setItem('customerRecords', JSON.stringify(records));
        
        // Add audit log
        addAuditLog('MARK_SOLD', recordId, records[recordIndex], {
            message: `Record marked as sold: ${records[recordIndex].customerName}`,
            previousStatus: oldRecord.status || 'active',
            billNumber: records[recordIndex].billNo
        });
        
        // Refresh the display
        if (context === 'all') {
            loadAllRecords();
        } else {
            searchRecords();
        }
        
        alert('Record marked as sold successfully!');
    }
}

// Excel Export functionality
function exportToExcel() {
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    if (records.length === 0) {
        showMessage('excelMessage', 'No records to export.', 'warning');
        return;
    }

    // Prepare data for Excel
    const excelData = records.map(record => ({
        'Bill Number': record.billNo,
        'Bill Date': record.billDate || '',
        'Customer Name': record.customerName,
        'Phone Number': record.phoneNumber || '',
        'Address': record.address,
        'Item Name': record.itemName,
        'Item Type': record.itemType,
        'Item Amount': record.itemAmount,
        'Interest (%)': record.interest,
        'Weight (grams)': record.weight,
        'Purity': record.purity || '',
        'Pending Money': record.pendingMoney || 0,
        'Extra Money Count': record.extraMoneyCount || 0,
        'Money Back Count': record.moneyBackCount || 0,
        'Notes': record.notes || '',
        'Status': record.status || 'active',
        'Created Date': record.createdAt ? new Date(record.createdAt).toLocaleDateString() : '',
        'Sold Date': record.soldAt ? new Date(record.soldAt).toLocaleDateString() : ''
    }));

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customer Records');

    // Generate filename with current date
    const now = new Date();
    const filename = `customer_records_${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
    
    showMessage('excelMessage', `Successfully exported ${records.length} records to ${filename}`, 'success');
}

// Excel Import functionality
function importFromExcel() {
    const fileInput = document.getElementById('excelFile');
    const file = fileInput.files[0];

    if (!file) {
        return;
    }

    const progressDiv = document.getElementById('importProgress');
    progressDiv.style.display = 'block';
    progressDiv.innerHTML = 'Reading Excel file...';

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Get first worksheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convert to JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            if (jsonData.length === 0) {
                showMessage('excelMessage', 'Excel file is empty or has no valid data.', 'error');
                progressDiv.style.display = 'none';
                return;
            }

            progressDiv.innerHTML = 'Processing records...';
            
            // Process imported data
            const importedRecords = [];
            const errors = [];
            const existingRecords = JSON.parse(localStorage.getItem('customerRecords') || '[]');
            
            jsonData.forEach((row, index) => {
                try {
                    const record = {
                        id: Date.now().toString() + '_' + index,
                        billNo: (row['Bill Number'] || '').toString().trim(),
                        billDate: row['Bill Date'] || '',
                        customerName: (row['Customer Name'] || '').toString().trim(),
                        phoneNumber: (row['Phone Number'] || '').toString().trim(),
                        address: (row['Address'] || '').toString().trim(),
                        itemName: (row['Item Name'] || '').toString().trim(),
                        itemType: (row['Item Type'] || '').toString().trim(),
                        itemAmount: parseFloat(row['Item Amount']) || 0,
                        interest: parseFloat(row['Interest (%)']) || 0,
                        weight: parseFloat(row['Weight (grams)']) || 0,
                        purity: (row['Purity'] || '').toString().trim(),
                        pendingMoney: parseFloat(row['Pending Money']) || 0,
                        extraMoneyCount: parseInt(row['Extra Money Count']) || 0,
                        extraMoney: [],
                        moneyBackCount: parseInt(row['Money Back Count']) || 0,
                        moneyBack: [],
                        notes: (row['Notes'] || '').toString().trim(),
                        status: (row['Status'] || 'active').toString().toLowerCase(),
                        createdAt: new Date().toISOString()
                    };

                    // Validate status
                    if (record.status !== 'active' && record.status !== 'sold') {
                        record.status = 'active';
                    }

                    // Validate required fields
                    if (!record.billNo || !record.customerName || !record.address || 
                        !record.itemName || !record.itemType || record.itemAmount <= 0 || 
                        record.interest < 0 || record.weight <= 0) {
                        errors.push(`Row ${index + 2}: Missing or invalid required fields`);
                        return;
                    }

                    // Check if bill number already exists
                    if (existingRecords.find(r => r.billNo === record.billNo) || 
                        importedRecords.find(r => r.billNo === record.billNo)) {
                        errors.push(`Row ${index + 2}: Bill number ${record.billNo} already exists`);
                        return;
                    }

                    // Validate item type
                    if (record.itemType !== 'Gold' && record.itemType !== 'Silver') {
                        errors.push(`Row ${index + 2}: Item type must be 'Gold' or 'Silver'`);
                        return;
                    }

                    importedRecords.push(record);
                } catch (error) {
                    errors.push(`Row ${index + 2}: Error processing data - ${error.message}`);
                }
            });

            // Display results
            if (importedRecords.length > 0) {
                // Add imported records to existing records
                const allRecords = existingRecords.concat(importedRecords);
                localStorage.setItem('customerRecords', JSON.stringify(allRecords));
                
                let message = `Successfully imported ${importedRecords.length} records.`;
                if (errors.length > 0) {
                    message += ` ${errors.length} errors occurred.`;
                }
                showMessage('excelMessage', message, 'success');
                
                // Refresh displays
                loadAllRecords();
            } else {
                showMessage('excelMessage', 'No valid records found to import.', 'error');
            }

            if (errors.length > 0) {
                progressDiv.innerHTML = `<strong>Import Errors:</strong><br>${errors.join('<br>')}`;
            } else {
                progressDiv.style.display = 'none';
            }

            // Clear file input
            fileInput.value = '';

        } catch (error) {
            showMessage('excelMessage', `Error reading Excel file: ${error.message}`, 'error');
            progressDiv.style.display = 'none';
        }
    };

    reader.readAsArrayBuffer(file);
}

// Download template functionality
function downloadTemplate() {
    const templateData = [{
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
        'Notes': 'Sample record for template',
        'Status': 'active'
    }];

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(templateData);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    // Save file
    XLSX.writeFile(wb, 'customer_records_template.xlsx');
    
    showMessage('excelMessage', 'Template downloaded successfully!', 'success');
}

// Edit record functionality
function editRecord(recordId) {
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    const record = records.find(r => r.id === recordId);
    
    if (!record) {
        alert('Record not found!');
        return;
    }

    editingRecord = record;
    
    // Populate edit form
    document.getElementById('editId').value = record.id;
    document.getElementById('editBillNo').value = record.billNo;
    document.getElementById('editBillDate').value = record.billDate;
    document.getElementById('editCustomerName').value = record.customerName;
    document.getElementById('editPhoneNumber').value = record.phoneNumber || '';
    document.getElementById('editAddress').value = record.address;
    document.getElementById('editItemName').value = record.itemName;
    document.getElementById('editItemType').value = record.itemType;
    document.getElementById('editItemAmount').value = record.itemAmount;
    document.getElementById('editInterest').value = record.interest;
    document.getElementById('editWeight').value = record.weight;
    document.getElementById('editPurity').value = record.purity || '';
    document.getElementById('editPendingMoney').value = record.pendingMoney || 0;
    document.getElementById('editNotes').value = record.notes || '';
    document.getElementById('editExtraMoneyCount').value = record.extraMoneyCount || 0;
    document.getElementById('editMoneyBackCount').value = record.moneyBackCount || 0;
    
    // Generate edit fields for extra money and money back
    generateEditExtraMoneyFields();
    generateEditMoneyBackFields();
    
    // Populate extra money data
    if (record.extraMoney) {
        record.extraMoney.forEach((extra, index) => {
            const amountField = document.getElementById(`editExtraAmount${index + 1}`);
            const dateField = document.getElementById(`editExtraStartDate${index + 1}`);
            if (amountField) amountField.value = extra.amount;
            if (dateField) dateField.value = extra.startDate;
        });
    }
    
    // Populate money back data
    if (record.moneyBack) {
        record.moneyBack.forEach((back, index) => {
            const amountField = document.getElementById(`editBackAmount${index + 1}`);
            const dateField = document.getElementById(`editBackDate${index + 1}`);
            if (amountField) amountField.value = back.amount;
            if (dateField) dateField.value = back.paymentDate;
        });
    }
    
    // Show modal
    document.getElementById('editModal').style.display = 'block';
}

// Update record functionality
function updateRecord(e) {
    e.preventDefault();
    
    const recordId = document.getElementById('editId').value;
    const editExtraMoneyCount = parseInt(document.getElementById('editExtraMoneyCount').value) || 0;
    const editMoneyBackCount = parseInt(document.getElementById('editMoneyBackCount').value) || 0;
    
    // Collect extra money data
    const extraMoney = [];
    for (let i = 1; i <= editExtraMoneyCount; i++) {
        const amount = document.getElementById(`editExtraAmount${i}`)?.value;
        const date = document.getElementById(`editExtraStartDate${i}`)?.value;
        if (amount && date) {
            extraMoney.push({
                amount: parseFloat(amount),
                startDate: date
            });
        }
    }
    
    // Collect money back data
    const moneyBack = [];
    for (let i = 1; i <= editMoneyBackCount; i++) {
        const amount = document.getElementById(`editBackAmount${i}`)?.value;
        const date = document.getElementById(`editBackDate${i}`)?.value;
        if (amount && date) {
            moneyBack.push({
                amount: parseFloat(amount),
                paymentDate: date
            });
        }
    }
    
    const updatedRecord = {
        id: recordId,
        billNo: document.getElementById('editBillNo').value.trim(),
        billDate: document.getElementById('editBillDate').value,
        customerName: document.getElementById('editCustomerName').value.trim(),
        phoneNumber: document.getElementById('editPhoneNumber').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        itemName: document.getElementById('editItemName').value.trim(),
        itemType: document.getElementById('editItemType').value,
        itemAmount: parseFloat(document.getElementById('editItemAmount').value),
        interest: parseFloat(document.getElementById('editInterest').value),
        weight: parseFloat(document.getElementById('editWeight').value),
        purity: document.getElementById('editPurity').value.trim(),
        notes: document.getElementById('editNotes').value.trim(),
        pendingMoney: parseFloat(document.getElementById('editPendingMoney').value) || 0,
        extraMoneyCount: editExtraMoneyCount,
        extraMoney: extraMoney,
        moneyBackCount: editMoneyBackCount,
        moneyBack: moneyBack,
        status: editingRecord.status || 'active', // Keep existing status
        createdAt: editingRecord.createdAt, // Keep original creation date
        updatedAt: new Date().toISOString()
    };

    // Validate required fields
    if (!updatedRecord.billNo || !updatedRecord.customerName || !updatedRecord.address || 
        !updatedRecord.itemName || !updatedRecord.itemType || isNaN(updatedRecord.itemAmount) || 
        isNaN(updatedRecord.interest) || isNaN(updatedRecord.weight)) {
        alert('Please fill all required fields correctly.');
        return;
    }

    // Get existing records
    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    
    // Check if bill number already exists (excluding current record)
    if (records.find(r => r.billNo === updatedRecord.billNo && r.id !== recordId)) {
        alert('Bill number already exists. Please use a different bill number.');
        return;
    }

    // Update the record
    const recordIndex = records.findIndex(r => r.id === recordId);
    if (recordIndex !== -1) {
        const oldRecord = {...editingRecord};
        records[recordIndex] = updatedRecord;
        localStorage.setItem('customerRecords', JSON.stringify(records));
        
        // Add audit log
        const changes = [];
        Object.keys(updatedRecord).forEach(key => {
            if (oldRecord[key] !== updatedRecord[key] && key !== 'updatedAt') {
                changes.push(`${key}: "${oldRecord[key]}" → "${updatedRecord[key]}"`);
            }
        });
        
        addAuditLog('UPDATE', recordId, updatedRecord, {
            message: `Record updated: ${updatedRecord.customerName}`,
            changes: changes,
            billNumber: updatedRecord.billNo,
            previousData: oldRecord
        });
        
        // Close modal
        closeEditModal();
        
        // Refresh displays
        loadAllRecords();
        if (document.getElementById('searchValue').value.trim()) {
            searchRecords();
        }
        
        alert('Record updated successfully!');
    } else {
        alert('Error updating record. Record not found.');
    }
}

// Close edit modal
function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    editingRecord = null;
}

// Show record history
function showRecordHistory(recordId) {
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    const record = records.find(r => r.id === recordId);
    const history = getRecordHistory(recordId);
    
    if (!record) {
        alert('Record not found!');
        return;
    }
    
    const modal = document.getElementById('historyModal');
    const content = document.getElementById('historyContent');
    
    if (history.length === 0) {
        content.innerHTML = `
            <div class="no-records">
                <h3>${record.customerName} - Bill #${record.billNo}</h3>
                <p>No history available for this record.</p>
            </div>
        `;
    } else {
        let historyHtml = `
            <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 10px;">
                <h3>${record.customerName} - Bill #${record.billNo}</h3>
                <p><strong>Current Status:</strong> ${record.status === 'sold' ? '✅ Sold' : '🔄 Active'}</p>
            </div>
            <div class="timeline">
        `;
        
        // Sort history by timestamp (newest first)
        const sortedHistory = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        sortedHistory.forEach(entry => {
            const date = new Date(entry.timestamp);
            const actionIcon = {
                'CREATE': '✨',
                'UPDATE': '✏️',
                'DELETE': '🗑️',
                'MARK_SOLD': '💰'
            }[entry.action] || '📝';
            
            const actionColor = {
                'CREATE': '#28a745',
                'UPDATE': '#ffc107',
                'DELETE': '#dc3545',
                'MARK_SOLD': '#17a2b8'
            }[entry.action] || '#6c757d';
            
            historyHtml += `
                <div class="timeline-entry" style="border-left: 4px solid ${actionColor}; margin-bottom: 15px; padding: 15px; background: white; border-radius: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h4 style="margin: 0; color: ${actionColor};">${actionIcon} ${entry.action.replace('_', ' ')}</h4>
                        <span style="font-size: 12px; color: #666;">${date.toLocaleString()}</span>
                    </div>
                    <p style="margin: 5px 0; color: #333;"><strong>User:</strong> ${entry.user} ${entry.userRole === 'admin' ? '(Admin)' : ''}</p>
                    <p style="margin: 5px 0; color: #666;">${entry.details.message || 'No details available'}</p>
            `;
            
            if (entry.details.changes && entry.details.changes.length > 0) {
                historyHtml += `
                    <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                        <strong>Changes:</strong>
                        <ul style="margin: 5px 0; padding-left: 20px;">
                `;
                entry.details.changes.forEach(change => {
                    historyHtml += `<li style="font-size: 12px; color: #666;">${change}</li>`;
                });
                historyHtml += `</ul></div>`;
            }
            
            if (entry.details.bulkOperation) {
                historyHtml += `<p style="font-size: 12px; color: #007bff; margin-top: 5px;">💼 Bulk operation (${entry.details.totalRecords} records)</p>`;
            }
            
            historyHtml += `</div>`;
        });
        
        historyHtml += `</div>`;
        content.innerHTML = historyHtml;
    }
    
    modal.style.display = 'block';
}

// Close history modal
function closeHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
}

// Load audit logs (admin only)
function loadAuditLogs() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser || currentUser.role !== 'admin') {
        document.getElementById('auditResults').innerHTML = '<div class="no-records">Access denied. Admin privileges required.</div>';
        return;
    }
    
    let auditLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    
    // Apply filters
    const actionFilter = document.getElementById('auditFilter').value;
    const userFilter = document.getElementById('auditUserFilter').value;
    const dateFilter = document.getElementById('auditDateFilter').value;
    
    if (actionFilter) {
        auditLogs = auditLogs.filter(log => log.action === actionFilter);
    }
    
    if (userFilter) {
        auditLogs = auditLogs.filter(log => log.user === userFilter);
    }
    
    if (dateFilter) {
        const filterDate = new Date(dateFilter).toDateString();
        auditLogs = auditLogs.filter(log => new Date(log.timestamp).toDateString() === filterDate);
    }
    
    // Sort by timestamp (newest first)
    auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    displayAuditLogs(auditLogs);
    populateUserFilter();
}

// Display audit logs
function displayAuditLogs(auditLogs) {
    const container = document.getElementById('auditResults');
    
    if (auditLogs.length === 0) {
        container.innerHTML = '<div class="no-records">No audit logs found</div>';
        return;
    }
    
    let html = `<div class="record-count">Total Audit Entries: ${auditLogs.length}</div>`;
    
    auditLogs.forEach(log => {
        const date = new Date(log.timestamp);
        const actionIcon = {
            'CREATE': '✨',
            'UPDATE': '✏️',
            'DELETE': '🗑️',
            'MARK_SOLD': '💰'
        }[log.action] || '📝';
        
        const actionColor = {
            'CREATE': '#28a745',
            'UPDATE': '#ffc107',
            'DELETE': '#dc3545',
            'MARK_SOLD': '#17a2b8'
        }[log.action] || '#6c757d';
        
        html += `
            <div class="record-card" style="border-left: 4px solid ${actionColor};">
                <div class="record-header">
                    <h4>${actionIcon} ${log.action.replace('_', ' ')} - ${log.customerName || 'Unknown'}</h4>
                    <span style="font-size: 14px; color: #666;">${date.toLocaleString()}</span>
                </div>
                <div class="record-details">
                    <div class="record-detail">
                        <strong>User</strong>
                        <span>${log.user} ${log.userRole === 'admin' ? '(Admin)' : ''}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Bill Number</strong>
                        <span>${log.billNumber || 'N/A'}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Action</strong>
                        <span style="color: ${actionColor}; font-weight: bold;">${log.action.replace('_', ' ')}</span>
                    </div>
                    <div class="record-detail">
                        <strong>Details</strong>
                        <span>${log.details.message || 'No details available'}</span>
                    </div>
        `;
        
        if (log.details.changes && log.details.changes.length > 0) {
            html += `
                <div class="record-detail" style="grid-column: span 2;">
                    <strong>Changes Made</strong>
                    <div style="margin-top: 5px;">
            `;
            log.details.changes.forEach(change => {
                html += `<div style="font-size: 12px; color: #666; margin: 2px 0;">• ${change}</div>`;
            });
            html += `</div></div>`;
        }
        
        if (log.details.bulkOperation) {
            html += `
                <div class="record-detail">
                    <strong>Operation Type</strong>
                    <span style="color: #007bff;">💼 Bulk Operation (${log.details.totalRecords} records)</span>
                </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// Populate user filter dropdown
function populateUserFilter() {
    const auditLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    const users = [...new Set(auditLogs.map(log => log.user))].sort();
    
    const userFilter = document.getElementById('auditUserFilter');
    const currentValue = userFilter.value;
    
    userFilter.innerHTML = '<option value="">All Users</option>';
    users.forEach(user => {
        userFilter.innerHTML += `<option value="${user}">${user}</option>`;
    });
    
    userFilter.value = currentValue;
}

// Analytics functions
let mainChart = null;
let secondaryChart = null;

function updateAnalytics() {
    const fromDate = document.getElementById('analyticsDateFrom').value;
    const toDate = document.getElementById('analyticsDateTo').value;
    const chartType = document.getElementById('analyticsType').value;
    
    const records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    let filteredRecords = records;
    
    // Filter by date range
    if (fromDate) {
        filteredRecords = filteredRecords.filter(record => 
            new Date(record.billDate) >= new Date(fromDate)
        );
    }
    if (toDate) {
        filteredRecords = filteredRecords.filter(record => 
            new Date(record.billDate) <= new Date(toDate)
        );
    }
    
    // Update summary cards
    updateSummaryCards(filteredRecords);
    
    // Update charts based on type
    switch(chartType) {
        case 'sales':
            createDailySalesChart(filteredRecords);
            createItemTypeChart(filteredRecords);
            break;
        case 'itemType':
            createItemTypeChart(filteredRecords);
            createStatusChart(filteredRecords);
            break;
        case 'status':
            createStatusChart(filteredRecords);
            createPendingChart(filteredRecords);
            break;
        case 'pending':
            createPendingChart(filteredRecords);
            createDailySalesChart(filteredRecords);
            break;
        case 'monthly':
            createMonthlyChart(filteredRecords);
            createItemTypeChart(filteredRecords);
            break;
    }
    
    // Update detailed analytics
    updateDetailedAnalytics(filteredRecords);
}

function updateSummaryCards(records) {
    const container = document.getElementById('summaryCards');
    
    const totalRecords = records.length;
    const totalAmount = records.reduce((sum, record) => sum + (record.itemAmount || 0), 0);
    const soldRecords = records.filter(r => r.status === 'sold').length;
    const activeRecords = records.filter(r => r.status !== 'sold').length;
    const totalPending = records.reduce((sum, record) => sum + (record.pendingMoney || 0), 0);
    const avgAmount = totalRecords > 0 ? totalAmount / totalRecords : 0;
    
    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>📊 Total Records</h3>
            <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${totalRecords}</p>
        </div>
        <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>💰 Total Amount</h3>
            <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${totalAmount.toLocaleString()}</p>
        </div>
        <div style="background: linear-gradient(135deg, #17a2b8 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>✅ Sold Items</h3>
            <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${soldRecords}</p>
        </div>
        <div style="background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>🔄 Active Items</h3>
            <p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${activeRecords}</p>
        </div>
        <div style="background: linear-gradient(135deg, #dc3545 0%, #e74c3c 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>⏳ Pending Money</h3>
            <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${totalPending.toLocaleString()}</p>
        </div>
        <div style="background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">
            <h3>📈 Avg Amount</h3>
            <p style="font-size: 20px; font-weight: bold; margin: 10px 0;">₹${avgAmount.toLocaleString()}</p>
        </div>
    `;
}

function createDailySalesChart(records) {
    const salesByDate = {};
    records.forEach(record => {
        const date = record.billDate;
        if (date) {
            salesByDate[date] = (salesByDate[date] || 0) + (record.itemAmount || 0);
        }
    });
    
    const dates = Object.keys(salesByDate).sort();
    const amounts = dates.map(date => salesByDate[date]);
    
    if (mainChart) mainChart.destroy();
    
    const ctx = document.getElementById('mainChart').getContext('2d');
    mainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Daily Sales (₹)',
                data: amounts,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                borderWidth: 2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Daily Sales Trend'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₹' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

function createItemTypeChart(records) {
    const typeCount = {};
    records.forEach(record => {
        const type = record.itemType || 'Unknown';
        typeCount[type] = (typeCount[type] || 0) + 1;
    });
    
    const labels = Object.keys(typeCount);
    const data = Object.values(typeCount);
    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
    
    if (secondaryChart) secondaryChart.destroy();
    
    const ctx = document.getElementById('secondaryChart').getContext('2d');
    secondaryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Item Type Distribution'
                },
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function createStatusChart(records) {
    const statusCount = {
        'Active': records.filter(r => r.status !== 'sold').length,
        'Sold': records.filter(r => r.status === 'sold').length
    };
    
    if (mainChart) mainChart.destroy();
    
    const ctx = document.getElementById('mainChart').getContext('2d');
    mainChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(statusCount),
            datasets: [{
                data: Object.values(statusCount),
                backgroundColor: ['#ffc107', '#28a745'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Item Status Distribution'
                }
            }
        }
    });
}

function createPendingChart(records) {
    const pendingRanges = {
        'No Pending': 0,
        '₹1-1000': 0,
        '₹1001-5000': 0,
        '₹5001-10000': 0,
        '₹10000+': 0
    };
    
    records.forEach(record => {
        const pending = record.pendingMoney || 0;
        if (pending === 0) {
            pendingRanges['No Pending']++;
        } else if (pending <= 1000) {
            pendingRanges['₹1-1000']++;
        } else if (pending <= 5000) {
            pendingRanges['₹1001-5000']++;
        } else if (pending <= 10000) {
            pendingRanges['₹5001-10000']++;
        } else {
            pendingRanges['₹10000+']++;
        }
    });
    
    if (mainChart) mainChart.destroy();
    
    const ctx = document.getElementById('mainChart').getContext('2d');
    mainChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(pendingRanges),
            datasets: [{
                label: 'Number of Records',
                data: Object.values(pendingRanges),
                backgroundColor: ['#28a745', '#ffc107', '#fd7e14', '#dc3545', '#6f42c1'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Pending Money Distribution'
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function createMonthlyChart(records) {
    const monthlyData = {};
    records.forEach(record => {
        if (record.billDate) {
            const month = record.billDate.substring(0, 7); // YYYY-MM
            monthlyData[month] = (monthlyData[month] || 0) + (record.itemAmount || 0);
        }
    });
    
    const months = Object.keys(monthlyData).sort();
    const amounts = months.map(month => monthlyData[month]);
    
    if (mainChart) mainChart.destroy();
    
    const ctx = document.getElementById('mainChart').getContext('2d');
    mainChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Monthly Revenue (₹)',
                data: amounts,
                backgroundColor: 'rgba(102, 126, 234, 0.6)',
                borderColor: '#667eea',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Monthly Revenue'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₹' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

function updateDetailedAnalytics(records) {
    const container = document.getElementById('detailedAnalytics');
    
    // Top customers by amount
    const customerTotals = {};
    records.forEach(record => {
        const name = record.customerName;
        customerTotals[name] = (customerTotals[name] || 0) + (record.itemAmount || 0);
    });
    
    const topCustomers = Object.entries(customerTotals)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
    
    // Recent transactions
    const recentTransactions = records
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
                <h4>🏆 Top 5 Customers by Amount</h4>
                <div style="margin-top: 10px;">
                    ${topCustomers.map(([name, amount], index) => `
                        <div style="display: flex; justify-content: space-between; padding: 8px; background: ${index % 2 === 0 ? '#f8f9fa' : 'white'}; border-radius: 5px; margin-bottom: 5px;">
                            <span>${index + 1}. ${name}</span>
                            <span style="font-weight: bold;">₹${amount.toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div>
                <h4>🕒 Recent Transactions</h4>
                <div style="margin-top: 10px;">
                    ${recentTransactions.map(record => `
                        <div style="padding: 8px; background: #f8f9fa; border-radius: 5px; margin-bottom: 5px;">
                            <div style="font-weight: bold;">${record.customerName}</div>
                            <div style="font-size: 12px; color: #666;">${record.billNo} - ₹${(record.itemAmount || 0).toLocaleString()}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

// Confirm delete functionality
function confirmDelete(recordId, containerId) {
    if (confirm('Are you sure you want to delete this record?\n\nThis action cannot be undone.')) {
        deleteRecord(recordId, containerId);
    }
}

// Delete record functionality
function deleteRecord(recordId, containerId) {
    let records = JSON.parse(localStorage.getItem('customerRecords') || '[]');
    const recordToDelete = records.find(r => r.id === recordId);
    
    if (recordToDelete) {
        // Add audit log before deletion
        addAuditLog('DELETE', recordId, recordToDelete, {
            message: `Record deleted: ${recordToDelete.customerName}`,
            billNumber: recordToDelete.billNo,
            itemType: recordToDelete.itemType,
            amount: recordToDelete.itemAmount
        });
    }
    
    records = records.filter(record => record.id !== recordId);
    localStorage.setItem('customerRecords', JSON.stringify(records));
    
    // Show confirmation
    alert('Record deleted successfully!');
    
    // Refresh the display
    if (containerId === 'allRecords') {
        loadAllRecords();
    } else {
        searchRecords();
    }
}

// Utility function to show messages
function showMessage(containerId, message, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="message ${type}">${message}</div>`;
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            container.innerHTML = '';
        }, 3000);
    }
}

// Search on Enter key press
document.getElementById('searchValue').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchRecords();
    }
});

// Close modal when clicking outside
window.onclick = function(event) {
    const editModal = document.getElementById('editModal');
    const historyModal = document.getElementById('historyModal');
    
    if (event.target === editModal) {
        closeEditModal();
    } else if (event.target === historyModal) {
        closeHistoryModal();
    }
}

// Close modal on Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeEditModal();
        closeHistoryModal();
    }
});
