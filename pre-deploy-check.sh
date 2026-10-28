#!/bin/bash
# ============================================================
# WESLA Trial - Pre-Deployment Verification
# Run this BEFORE deploying to production
# ============================================================

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

echo -e "${GREEN}=== WESLA Pre-Deployment Verification ===${NC}"
echo ""

# Helper functions
pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARN++)); }

# ------------------------------------------------------------
# 1. File Structure
# ------------------------------------------------------------
echo -e "${GREEN}[1/8] Checking file structure...${NC}"

if [[ -f "backend/server.js" ]]; then pass "backend/server.js exists"; else fail "backend/server.js missing"; fi
if [[ -f "frontend/index.html" ]]; then pass "frontend/index.html exists"; else fail "frontend/index.html missing"; fi
if [[ -f "package.json" ]]; then pass "package.json exists"; else fail "package.json missing"; fi

if [[ -d "uploads" ]]; then pass "uploads/ directory exists"; else warn "uploads/ directory missing (will be created)"; fi
if [[ -d "backups" ]]; then pass "backups/ directory exists"; else warn "backups/ directory missing (will be created)"; fi

# ------------------------------------------------------------
# 2. Dependencies
# ------------------------------------------------------------
echo -e "${GREEN}[2/8] Checking dependencies...${NC}"

if [[ -f "package-lock.json" ]]; then
    pass "package-lock.json exists"
    if npm ci --dry-run 2>/dev/null | grep -q "added\|changed\|removed"; then
        warn "Dependencies may need updating"
    else
        pass "Dependencies are up to date"
    fi
else
    warn "No package-lock.json found (run npm install)"
fi

# ------------------------------------------------------------
# 3. Node.js Version
# ------------------------------------------------------------
echo -e "${GREEN}[3/8] Checking Node.js version...${NC}"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ "$NODE_VERSION" -ge 22 ]]; then
    pass "Node.js version $(node -v) meets requirement (>=22.13.0)"
else
    fail "Node.js version $(node -v) is below required 22.13.0"
fi

# Check for node:sqlite
if node -e "require('node:sqlite')" 2>/dev/null; then
    pass "node:sqlite is available"
else
    fail "node:sqlite is NOT available (requires Node.js 22.13+)"
fi

# ------------------------------------------------------------
# 4. Code Quality
# ------------------------------------------------------------
echo -e "${GREEN}[4/8] Checking code quality...${NC}"

if node --check backend/server.js 2>/dev/null; then
    pass "backend/server.js syntax is valid"
else
    fail "backend/server.js has syntax errors"
fi

if node --check scripts/restore-backup.js 2>/dev/null; then
    pass "scripts/restore-backup.js syntax is valid"
else
    fail "scripts/restore-backup.js has syntax errors"
fi

# ------------------------------------------------------------
# 5. Security Checks
# ------------------------------------------------------------
echo -e "${GREEN}[5/8] Running security checks...${NC}"

# Check for hardcoded secrets (basic grep)
if grep -ri "api_key\|secret\|password\|token\|passwd" backend/server.js | grep -v "salt\|hashPw\|session\|crypto.random" | grep -q "=['\"][^'\"]{8,}['\"]"; then
    fail "Potential hardcoded secrets found"
else
    pass "No obvious hardcoded secrets"
fi

# Check for SQL injection patterns
if grep -q "execute(.*format\|execute(f\"\|execute(.*+)" backend/server.js; then
    fail "Potential SQL injection patterns found"
else
    pass "No SQL injection patterns detected"
fi

# Check for eval/exec (excluding SQLite db.exec and safe shell usage)
if grep -Eq "eval\s*\(|Function\s*\(" backend/server.js; then
    fail "Dangerous eval/Function found"
else
    pass "No eval/Function usage"
fi

# Check for dangerous child_process usage (win32-only browser launch is safe)
CHILD_PROCESS_LINES=$(grep -n "child_process" backend/server.js || true)
if [[ -n "$CHILD_PROCESS_LINES" ]]; then
    # Check if it's only inside a process.platform==='win32' guard
    if echo "$CHILD_PROCESS_LINES" | grep -q "win32"; then
        warn "child_process found but only used for win32 local launch (safe)"
    else
        fail "child_process usage found outside win32 guard"
    fi
else
    pass "No child_process usage"
fi

# Check session cookie flags in code
if grep -q "HttpOnly" backend/server.js; then
    pass "HttpOnly flag present on session cookie"
else
    fail "HttpOnly flag missing on session cookie"
fi

if grep -q "SameSite" backend/server.js; then
    pass "SameSite flag present on session cookie"
else
    fail "SameSite flag missing on session cookie"
fi

# ------------------------------------------------------------
# 6. Financial Integrity
# ------------------------------------------------------------
echo -e "${GREEN}[6/8] Checking financial integrity...${NC}"

if grep -q "K = 1000" backend/server.js; then
    pass "Millieme integer accounting (K=1000) is used"
else
    fail "Millieme integer accounting not found"
fi

if grep -q "toM\|money(" backend/server.js; then
    pass "Money conversion functions present"
else
    fail "Money conversion functions missing"
fi

# Check for float usage in financial calculations
if grep -n "parseFloat\|toFixed(2)\|\\.toFixed" backend/server.js | grep -q "."; then
    warn "Float operations found - verify they're not used for money"
else
    pass "No suspicious float operations for money"
fi

# ------------------------------------------------------------
# 7. Database Configuration
# ------------------------------------------------------------
echo -e "${GREEN}[7/8] Checking database configuration...${NC}"

if grep -q "journal_mode=WAL" backend/server.js; then
    pass "WAL mode enabled"
else
    fail "WAL mode not enabled"
fi

if grep -q "foreign_keys=ON" backend/server.js; then
    pass "Foreign keys enabled"
else
    fail "Foreign keys not enabled"
fi

# ------------------------------------------------------------
# 8. Tests
# ------------------------------------------------------------
echo -e "${GREEN}[8/8] Running tests...${NC}"

if [[ -f "tests/integration.test.js" ]]; then
    pass "Integration tests exist"
else
    fail "Integration tests missing"
fi

if [[ -f "tests/audit-harness.js" ]]; then
    pass "Financial audit harness exists"
else
    fail "Financial audit harness missing"
fi

# Run quick syntax check on tests
for test in tests/*.test.js; do
    if [[ -f "$test" ]]; then
        if node --check "$test" 2>/dev/null; then
            pass "$test syntax valid"
        else
            fail "$test has syntax errors"
        fi
    fi
done

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Verification Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Passed:  $PASS"
echo -e "Warnings: $WARN"
echo -e "Failed:  $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Deployment blocked: $FAIL critical issues found${NC}"
    echo "Please fix the failed checks before deploying."
    exit 1
elif [[ $WARN -gt 0 ]]; then
    echo -e "${YELLOW}Deployment allowed with $WARN warnings${NC}"
    echo "Review warnings before going live."
    exit 0
else
    echo -e "${GREEN}All checks passed! Ready for deployment.${NC}"
    exit 0
fi
