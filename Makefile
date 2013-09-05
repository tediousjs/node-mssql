compile:
	@coffee --compile --output ./lib ./src

watch:
	@coffee --compile --watch --output ./lib ./src

test:
	@mocha --compilers coffee:coffee-script --reporter spec

.PHONY: test