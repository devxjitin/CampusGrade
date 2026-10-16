# Demo Import Files (with corrupt rows)

Use these two files to test bulk upload:

- teachers_import_demo_with_corrupt_rows.csv
- students_import_demo_with_corrupt_rows.csv

## Expected result (first upload on a clean DB for these emails/IDs)

### Teachers file
- Total rows: 10
- Added: 3
- Duplicates: 2
- Invalid: 5

Corrupt examples included:
- duplicate email in same file
- duplicate teacher_id in same file
- missing required values
- invalid teacher_id format
- contact number with fewer than 2 digits

### Students file
- Total rows: 10
- Added: 3
- Duplicates: 2
- Invalid: 5

Corrupt examples included:
- duplicate email in same file
- duplicate roll_no in same file
- missing required values
- roll_no without enough digits for password formula
- invalid year value (outside 1 to 12)

## Notes
- If you upload the same file again, duplicates will increase and added count will decrease.
- These files use unique demo emails so first-run testing is predictable.
